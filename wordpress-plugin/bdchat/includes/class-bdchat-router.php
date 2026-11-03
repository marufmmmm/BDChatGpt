<?php
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Smart routing: classify the message with a cheap model, then pick a model
 * from the admin's routing table, limited to the environment's models.
 */
class BDChat_Router
{
    const LABELS = ['simple', 'standard', 'complex', 'code', 'long_document', 'very_complex'];
    const LANGUAGES = ['auto', 'bangla', 'english'];
    const OPTION = 'bdchat_routing';

    /** Cheapest suitable classifiers, tried in order. Must be active in the catalog to be used. */
    const CLASSIFIERS = ['openai/gpt-6-luna', 'google/gemini-3.1-flash-lite'];

    /**
     * Default routing rules per environment (model IDs in preference order).
     * Smart AI uses every switched-on model. Each provider environment uses only its own models.
     */
    public static function defaults(): array
    {
        return [
            'smart' => [
                'simple' => ['deepseek/deepseek-flash', 'openai/gpt-6-luna', 'google/gemini-3.1-flash-lite'],
                'standard' => ['deepseek/deepseek-v4-pro', 'google/gemini-3.8-flash', 'openai/gpt-6.1-terra'],
                'complex' => ['x-ai/grok-4.7', 'openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5.5', 'google/gemini-3.1-pro-preview'],
                'code' => ['anthropic/claude-sonnet-5.5', 'openai/gpt-6.1-sol', 'x-ai/grok-4.7'],
                'long_document' => ['x-ai/grok-4.3', 'google/gemini-3.1-pro-preview'],
                'very_complex' => ['openai/gpt-6-astra', 'anthropic/claude-opus-5.5'],
            ],
            'openai' => [
                'simple' => ['openai/gpt-6-luna'],
                'standard' => ['openai/gpt-6.1-terra'],
                'complex' => ['openai/gpt-6.1-sol'],
                'code' => ['openai/gpt-6.1-sol'],
                'long_document' => ['openai/gpt-6.1-terra'],
                'very_complex' => ['openai/gpt-6-astra'],
            ],
            'anthropic' => [
                'simple' => ['anthropic/claude-sonnet-5.5'],
                'standard' => ['anthropic/claude-sonnet-5.5'],
                'complex' => ['anthropic/claude-sonnet-5.5'],
                'code' => ['anthropic/claude-sonnet-5.5'],
                'long_document' => ['anthropic/claude-sonnet-5.5'],
                'very_complex' => ['anthropic/claude-opus-5.5'],
            ],
            'google' => [
                'simple' => ['google/gemini-3.1-flash-lite'],
                'standard' => ['google/gemini-3.8-flash'],
                'complex' => ['google/gemini-3.1-pro-preview'],
                'code' => ['google/gemini-3.1-pro-preview'],
                'long_document' => ['google/gemini-3.1-pro-preview'],
                'very_complex' => ['google/gemini-4-argon'],
            ],
            'x-ai' => [
                'simple' => ['x-ai/grok-build-0.1'],
                'standard' => ['x-ai/grok-4.3'],
                'complex' => ['x-ai/grok-4.7'],
                'code' => ['x-ai/grok-4.7'],
                'long_document' => ['x-ai/grok-4.3'],
                'very_complex' => ['x-ai/grok-4.7'],
            ],
            'deepseek' => [
                'simple' => ['deepseek/deepseek-flash'],
                'standard' => ['deepseek/deepseek-v4-pro'],
                'complex' => ['deepseek/deepseek-v4-pro'],
                'code' => ['deepseek/deepseek-v4-pro'],
                'long_document' => ['deepseek/deepseek-v4-pro'],
                'very_complex' => ['deepseek/deepseek-v4-pro'],
            ],
        ];
    }

    /** Routing rules for one environment: saved by the admin, or the default. */
    public static function table(string $env = 'smart'): array
    {
        $defaults = self::defaults();
        $table = $defaults[$env] ?? $defaults['smart'];
        $saved = get_option(self::OPTION);
        if (is_array($saved) && isset($saved[$env]) && is_array($saved[$env])) {
            foreach (self::LABELS as $label) {
                if (isset($saved[$env][$label]) && is_array($saved[$env][$label])) {
                    $table[$label] = array_values(array_filter(array_map('sanitize_text_field', $saved[$env][$label])));
                }
            }
        }
        return $table;
    }

    /** All environments' rules, for the admin screen. */
    public static function all_tables(): array
    {
        $out = [];
        foreach (array_keys(self::defaults()) as $env) {
            $out[$env] = self::table($env);
        }
        return $out;
    }

    public static function save_table(string $env, array $raw): array
    {
        if (!isset(self::defaults()[$env])) {
            $env = 'smart';
        }
        $clean = [];
        foreach (self::LABELS as $label) {
            $ids = isset($raw[$label]) && is_array($raw[$label]) ? $raw[$label] : [];
            $clean[$label] = array_values(array_unique(array_filter(array_map(
                fn($id) => substr(sanitize_text_field((string) $id), 0, 190), $ids
            ))));
        }
        $all = get_option(self::OPTION);
        $all = is_array($all) ? $all : [];
        $all[$env] = $clean;
        update_option(self::OPTION, $all);
        return $clean;
    }

    /** Pick the classifier model from the catalog (must be active). */
    public static function classifier_row(): ?array
    {
        foreach (self::CLASSIFIERS as $id) {
            $row = BDChat_Models::find_by_model_id($id);
            if ($row && (int) $row['is_active']) {
                return $row;
            }
        }
        return null;
    }

    /**
     * Ask the classifier for one label. Returns [label, input_tokens, output_tokens].
     * On any problem it returns 'standard' with zero tokens, so routing never blocks a reply.
     */
    public static function classify(array $clean, array $classifier): array
    {
        $last = '';
        for ($i = count($clean) - 1; $i >= 0; $i--) {
            if ($clean[$i]['role'] === 'user') {
                $last = $clean[$i]['content'];
                break;
            }
        }
        $snippet = mb_substr($last, 0, 1500);
        $instruction = 'Classify the user message into exactly one label: '
            . 'simple (greetings, short facts, translation, quick questions), '
            . 'standard (everyday writing, explanations, summaries, normal chat), '
            . 'complex (multi-step reasoning, analysis, planning, math, research), '
            . 'code (programming, debugging, technical implementation), '
            . 'very_complex (hard expert problems needing the strongest model). '
            . 'Then, after a space, write yes if answering well needs facts from the web, otherwise no. '
            . 'Answer yes for: news and recent events; prices, fares, rates and costs; contact details, phone numbers, WhatsApp, addresses and websites; '
            . 'named businesses, agencies, shops, hotels, doctors, schools or products and recommendations of them; schedules, opening hours, availability, '
            . 'laws, visas, rules and fees; scores and results; anything that may have changed; anything the user asks to check online. '
            . 'When unsure, answer yes. '
            . 'Reply with the label and yes or no only, nothing else.';
        $res = BDChat_Providers::chat($classifier['model_id'], [
            ['role' => 'system', 'content' => $instruction],
            ['role' => 'user', 'content' => $snippet],
        ], 12, null, null);
        if (is_wp_error($res)) {
            return ['standard', 0, 0, self::web_hint($last)];
        }
        $words = preg_split('/[^a-z_]+/i', strtolower((string) $res['content']), -1, PREG_SPLIT_NO_EMPTY);
        $label = 'standard';
        foreach ($words as $w) {
            if (in_array($w, self::LABELS, true)) {
                $label = $w;
                break;
            }
        }
        $needs_web = in_array('yes', $words, true) || self::web_hint($last);
        return [$label, (int) $res['input_tokens'], (int) $res['output_tokens'], $needs_web];
    }

    /** Words that usually mean the answer needs current facts (English and Bangla). Used if the classifier is missing or unsure. */
    const WEB_HINTS = '/\b(news|today|todays|latest|current|recent|now|price|prices|rate|rates|score|scores|stock|market|weather|update|updates|live|2026|this week|this month|headline|headlines|breaking|trending|viral|ajke|aj|ajker|ajer|khobor|khabor|shongbad|sangbad|bazar|bajar|dam|ekhon|ekhane|sporti|somprotik|somprobbo|contact|phone|number|whatsapp|website|address|email|hotline|agency|fare|rent|rental|ticket|visa|hotel|flight|booking|price|cost|hours|opening|official|link)\b|আজ|সর্বশেষ|খবর|সংবাদ|দাম|বাজার|এখন|সম্প্রতি|লাইভ|আজকের|শিরোনাম|ভাইরাল|যোগাযোগ|ফোন|নম্বর|হোয়াটসঅ্যাপ|হোয়াটস|ঠিকানা|ওয়েবসাইট|লিংক|এজেন্সি|ভাড়া|টিকেট|ভিসা|রেট|খরচ/iu';

    /** A book, guide, chapter, report or other long document: needs a strong model and a long answer. */
    public static function doc_hint(string $text): bool
    {
        return (bool) preg_match('/\b(ebook|e-book|book|guide|chapter|document|report|pdf|outline|table of contents)\b|বই|গাইড|অধ্যায়|ডকুমেন্ট|সূচিপত্র|রিপোর্ট/iu', $text);
    }

    public static function web_hint(string $text): bool
    {
        return (bool) preg_match(self::WEB_HINTS, $text);
    }

    /** Models that answer everyday questions quickly. They are tried first for simple and standard questions. */
    const FAST_MODELS = ['google/gemini-3.8-flash', 'deepseek/deepseek-flash', 'openai/gpt-6-luna', 'google/gemini-3.1-flash-lite'];

    /** Keep the order, but move fast models to the front. */
    public static function fast_first(array $list): array
    {
        $fast = [];
        $rest = [];
        foreach ($list as $m) {
            if (in_array($m['model_id'], self::FAST_MODELS, true)) {
                $fast[] = $m;
            } else {
                $rest[] = $m;
            }
        }
        return array_merge($fast, $rest);
    }

    /** Messages that are very long go straight to the long-document label. */
    public static function long_document_check(array $clean): bool
    {
        // Only the newest user message counts. Earlier turns of a long chat must not send every new question to a long-context model.
        $last = '';
        foreach ($clean as $m) {
            if (($m['role'] ?? '') === 'user') {
                $last = (string) $m['content'];
            }
        }
        return mb_strlen($last) > 6000;
    }

    /**
     * Ordered candidate models for a label, limited to the environment's pool.
     * If the table has nothing for this pool, use the pool itself (cheapest first for simple/standard).
     */
    public static function candidates(string $label, array $pool, string $env = 'smart'): array
    {
        $table = self::table($env);
        $by_id = [];
        foreach ($pool as $m) {
            $by_id[$m['model_id']] = $m;
        }
        $ordered = [];
        foreach ($table[$label] ?? [] as $id) {
            if (isset($by_id[$id])) {
                $ordered[] = $by_id[$id];
            }
        }
        if ($ordered) {
            return $ordered;
        }
        usort($pool, function ($a, $b) {
            return self::price_score($a) <=> self::price_score($b);
        });
        if (in_array($label, ['complex', 'code', 'very_complex', 'long_document'], true)) {
            $pool = array_reverse($pool);
        }
        return $pool;
    }

    public static function price_score(array $m): float
    {
        return (float) $m['input_cost_per_mtok'] + (float) $m['output_cost_per_mtok'];
    }

    /** Language instruction for the reply. Bangla is the default for Bangladeshi users. */
    public static function system_prompt(string $language): string
    {
        $format = 'Format replies with Markdown where it helps reading: short headings with #, **bold** for key words, '
            . 'numbered or bulleted lists (one item per line), and fenced code blocks for code. '
            . 'Keep paragraphs short with a blank line between them. Do not use tables. '
            . 'Only when the user asks for a file, add ONE block in this exact form after a short intro line, and write all text in the user\'s language: '
            . 'for a presentation or slides, use a ```slides block containing JSON {"title":"...","slides":[{"title":"...","bullets":["..."],"notes":"..."}]} (5 to 12 slides, 3 to 6 short bullets each); '
            . 'for a Word document or report, use a ```document block containing Markdown with the full text; '
            . 'for a spreadsheet, table or Excel file, use a ```sheet block containing JSON {"title":"...","rows":[["header1","header2"],["value1","value2"]]}. '
            . 'Never write the JSON outside its block. '
            . 'When the user asks for a prompt, a message, a caption, an email, a post or any other text they will copy and use somewhere else, put that text alone inside a fenced code block (```text) so it gets a copy button. Keep only a short intro line outside the block, and never tell the user to find a copy icon. '
            . 'When the user asks for a book, guide, chapter or long document (and not a file), write the whole text in Markdown with # and ## headings for the title and each chapter or section, and cover every section until the end. Do not wrap that text in a code block. '
            . 'Answer first, in one or two short sentences, then at most five short bullet points. Be warm and clear, and do not repeat the same warning. '
            . 'Never invent a rule or policy about what you may say. If the question needs current details (phone numbers, WhatsApp, addresses, prices, opening hours) and no web results are given, say in one short line that you have not checked them live, then give the quickest way to check (the official website Contact page or Google Maps). Never make up numbers or links. '
            . 'Never refuse an ordinary request. If you cannot verify a detail, say so in one short line and still give the most useful help you can: what you do know, the steps to find the rest, and what to check. Decline only content that is genuinely harmful. '
            . 'Do not put links, source names or citations inside the answer text. Never write a Sources list yourself; the app adds the real sources when it searched the web. Never say you cannot access the internet or live news. When web results are given, use them, and if they do not contain the answer, say which part is missing.';
        if ($language === 'bangla') {
            $lang = 'Always reply in Bangla (Bengali script), even if the user writes in English. Use simple, friendly Bangla.';
        } elseif ($language === 'english') {
            $lang = 'Always reply in English.';
        } else {
            $lang = 'Reply in the same language as the user\'s latest message, whatever that language is. Bengali question, Bengali answer. English question, English answer. If the user asks for a different language, use that language. Never default to Bangla or English on your own.';
        }
        return $lang . ' ' . $format;
    }

    /** Remove a Sources list the model wrote itself. Real sources are added by the app. */
    public static function strip_model_sources(string $text): string
    {
        return trim((string) preg_replace('/\n+\s*(?:\*\*)?(?:Sources?|সূত্র)(?:\*\*)?\s*:?\s*\n(?:\s*[-*]?\s*\[?[^\n]*https?:\/\/[^\n]*\n?)+\s*$/iu', '', $text));
    }

    /** Tidy the reply: normalise line endings and remove extra blank lines. Markdown is kept for display. */
    public static function plain_text(string $text): string
    {
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        $text = preg_replace("/\n{3,}/", "\n\n", $text);
        // Remove tracking parameters (utm_*) from any web address in the reply.
        $text = preg_replace('/\?utm_[^\s)\]&]*(&utm_[^\s)\]&]*)*/i', '', $text);
        $text = preg_replace('/&utm_[^\s)\]&]*/i', '', $text);
        return trim($text);
    }

    public static function normalize_language(?string $value): string
    {
        $value = strtolower((string) $value);
        return in_array($value, self::LANGUAGES, true) ? $value : 'auto';
    }
}
