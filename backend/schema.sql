create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique,
  email text unique not null,
  username text unique,
  full_name text default '',
  role text not null default 'client' check (role in ('client','reader','admin')),
  bio text default '',
  specialties text[] default '{}',
  profile_image text default '',
  pricing_chat integer default 0,
  pricing_voice integer default 0,
  pricing_video integer default 0,
  account_balance integer default 0,
  earnings_balance integer default 0,
  is_online boolean default false,
  stripe_customer_id text,
  created_at timestamptz default now()
);

create table if not exists readings (
  id uuid primary key default gen_random_uuid(),
  reader_id uuid not null references users(id),
  client_id uuid not null references users(id),
  type text not null check (type in ('chat','voice','video')),
  status text not null default 'pending' check (status in ('pending','accepted','in_progress','completed','cancelled')),
  price_per_minute integer not null,
  started_at timestamptz,
  completed_at timestamptz,
  duration integer default 0,
  total_price integer default 0,
  reader_earned integer default 0,
  payment_status text default 'pending',
  chat_transcript jsonb default '[]',
  rating integer,
  review text,
  end_reason text,
  created_at timestamptz default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  type text not null,
  amount integer not null,
  balance_before integer not null,
  balance_after integer not null,
  reading_id uuid,
  stripe_id text,
  note text default '',
  created_at timestamptz default now()
);

create table if not exists payment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  session_id text unique,
  amount integer not null,
  currency text default 'usd',
  payment_status text default 'initiated',
  metadata jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists forum_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users(id),
  title text not null,
  content text not null,
  is_deleted boolean default false,
  created_at timestamptz default now()
);

create table if not exists forum_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references forum_posts(id),
  author_id uuid not null references users(id),
  content text not null,
  is_deleted boolean default false,
  created_at timestamptz default now()
);

create table if not exists forum_flags (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('post','comment')),
  target_id uuid not null,
  flagged_by uuid references users(id),
  reason text default '',
  status text default 'open',
  created_at timestamptz default now()
);

create table if not exists rtc_sessions (
  id uuid primary key default gen_random_uuid(),
  reading_id uuid not null references readings(id),
  user_id uuid not null references users(id),
  cf_session_id text not null,
  tracks jsonb default '[]',
  created_at timestamptz default now(),
  unique(reading_id, user_id)
);

create table if not exists platform_settings (
  key text primary key,
  value jsonb not null
);

create table if not exists newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  created_at timestamptz default now()
);

insert into platform_settings (key, value) values ('reader_commission_pct', '60') on conflict (key) do nothing;

alter table users enable row level security;
alter table readings enable row level security;
alter table transactions enable row level security;
alter table payment_transactions enable row level security;
alter table forum_posts enable row level security;
alter table forum_comments enable row level security;
alter table forum_flags enable row level security;
alter table rtc_sessions enable row level security;
alter table platform_settings enable row level security;
alter table newsletter_subscribers enable row level security;

drop policy if exists users_self_select on users;
create policy users_self_select on users for select to authenticated using (auth_id = auth.uid());
drop policy if exists forum_posts_public on forum_posts;
create policy forum_posts_public on forum_posts for select using (is_deleted = false);
drop policy if exists forum_comments_public on forum_comments;
create policy forum_comments_public on forum_comments for select using (is_deleted = false);

create index if not exists idx_readings_reader on readings(reader_id);
create index if not exists idx_readings_client on readings(client_id);
create index if not exists idx_tx_user on transactions(user_id);
