ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS proxy_record JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE public.agent_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX agent_messages_user_created_idx ON public.agent_messages (user_id, created_at);
GRANT SELECT, INSERT ON public.agent_messages TO authenticated;
GRANT ALL ON public.agent_messages TO service_role;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own agent messages" ON public.agent_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can add their own agent messages" ON public.agent_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);