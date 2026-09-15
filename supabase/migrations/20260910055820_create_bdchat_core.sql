/*
# Create BDChat core persistence

1. New Tables
- `profiles`: one row per signed-in user with display name, plan, storage quota, and credits.
- `chat_threads`: chat history owned by a user.
- `chat_messages`: messages belonging to a user's chat thread.
- `stored_assets`: uploaded files and generated images with a hard 30-day expiry timestamp.

2. Security
- Row level security is enabled on every table.
- All access is limited to the authenticated owner through `auth.uid()`.
- Four separate CRUD policies are created for each table.

3. Important notes
- Profile rows default to the current authenticated user.
- Asset expiry is stored as a timestamp so daily cleanup can remove expired records later.
- Chat text remains independent from asset retention.
*/

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT 'BDChat User',
  plan text NOT NULL DEFAULT 'Free' CHECK (plan IN ('Free', 'Normal', 'Medium', 'Pro')),
  storage_used bigint NOT NULL DEFAULT 0 CHECK (storage_used >= 0),
  storage_limit bigint NOT NULL DEFAULT 104857600 CHECK (storage_limit > 0),
  paid_credits integer NOT NULL DEFAULT 0 CHECK (paid_credits >= 0),
  free_credits integer NOT NULL DEFAULT 5 CHECK (free_credits >= 0),
  images_used integer NOT NULL DEFAULT 0 CHECK (images_used >= 0),
  images_limit integer NOT NULL DEFAULT 2 CHECK (images_limit > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  model text NOT NULL DEFAULT 'GPT-4 Mini',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stored_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('file', 'image')),
  name text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  prompt text,
  url text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  deleted_at timestamptz
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stored_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Users can delete own profile" ON public.profiles;
CREATE POLICY "Users can delete own profile" ON public.profiles FOR DELETE TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can view own threads" ON public.chat_threads;
CREATE POLICY "Users can view own threads" ON public.chat_threads FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own threads" ON public.chat_threads;
CREATE POLICY "Users can insert own threads" ON public.chat_threads FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own threads" ON public.chat_threads;
CREATE POLICY "Users can update own threads" ON public.chat_threads FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own threads" ON public.chat_threads;
CREATE POLICY "Users can delete own threads" ON public.chat_threads FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own messages" ON public.chat_messages;
CREATE POLICY "Users can view own messages" ON public.chat_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own messages" ON public.chat_messages;
CREATE POLICY "Users can insert own messages" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND EXISTS (SELECT 1 FROM public.chat_threads WHERE chat_threads.id = thread_id AND chat_threads.user_id = auth.uid()));
DROP POLICY IF EXISTS "Users can update own messages" ON public.chat_messages;
CREATE POLICY "Users can update own messages" ON public.chat_messages FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own messages" ON public.chat_messages;
CREATE POLICY "Users can delete own messages" ON public.chat_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own assets" ON public.stored_assets;
CREATE POLICY "Users can view own assets" ON public.stored_assets FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own assets" ON public.stored_assets;
CREATE POLICY "Users can insert own assets" ON public.stored_assets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own assets" ON public.stored_assets;
CREATE POLICY "Users can update own assets" ON public.stored_assets FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete own assets" ON public.stored_assets;
CREATE POLICY "Users can delete own assets" ON public.stored_assets FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS chat_threads_user_updated_idx ON public.chat_threads(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_thread_created_idx ON public.chat_messages(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS stored_assets_user_expiry_idx ON public.stored_assets(user_id, expires_at);
