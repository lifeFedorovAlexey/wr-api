import "dotenv/config";
import { client } from "../db/client.js";

async function main() {
  await client.begin(async (sql) => {
    await sql.unsafe(`
      do $$
      begin
        if exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'quiz_attempts' and column_name = 'telegram_user_id'
        ) and not exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'quiz_attempts' and column_name = 'quiz_id'
        ) then
          alter table quiz_attempts rename to legacy_quiz_attempt_counters;
        end if;
      end $$;

      create table if not exists quiz_categories (
        id serial primary key, slug text not null unique, name text not null,
        is_active boolean not null default true, created_at timestamptz not null default now()
      );
      create table if not exists quizzes (
        id serial primary key, author_id integer not null, title text not null,
        short_description text, description text not null, cover_url text, category_id integer,
        tags text[] not null default '{}', age_restriction integer, language text not null default 'ru',
        estimated_minutes integer, status text not null default 'draft', visibility text not null default 'registered',
        attempt_limit_type text not null default 'unlimited', attempt_limit integer,
        available_from timestamptz, available_until timestamptz, participant_limit integer,
        hide_after_participant_limit boolean not null default false, settings jsonb not null default '{}',
        current_version_id integer, draft_version_id integer, blocked_reason text,
        published_at timestamptz, archived_at timestamptz, deleted_at timestamptz,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
      );
      create table if not exists quiz_versions (
        id serial primary key, quiz_id integer not null, version_number integer not null,
        status text not null default 'draft', start_question_id integer, settings jsonb not null default '{}',
        created_by_user_id integer not null, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(), published_at timestamptz,
        unique (quiz_id, version_number)
      );
      create table if not exists quiz_questions (
        id serial primary key, quiz_version_id integer not null, client_key text not null,
        type text not null, title text not null, description text, additional_description text,
        media jsonb not null default '[]', explanation text, external_url text,
        is_required boolean not null default true, position integer not null, score double precision not null default 0,
        settings jsonb not null default '{}', default_next_question_id integer, default_next_result_id integer,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        unique (quiz_version_id, position), unique (quiz_version_id, client_key)
      );
      create table if not exists quiz_results (
        id serial primary key, quiz_version_id integer not null, client_key text not null,
        title text not null, short_description text, description text, image_url text,
        min_score double precision, max_score double precision, conditions jsonb,
        recommendations text, action_url text, action_label text, priority integer not null default 0,
        is_default boolean not null default false, position integer not null default 0,
        created_at timestamptz not null default now(), unique (quiz_version_id, client_key)
      );
      create unique index if not exists quiz_results_one_default_uidx
        on quiz_results (quiz_version_id) where is_default = true;
      create table if not exists quiz_answer_options (
        id serial primary key, question_id integer not null, client_key text not null,
        text text, description text, image_url text, is_correct boolean not null default false,
        score double precision not null default 0, category_scores jsonb not null default '{}',
        next_question_id integer, next_result_id integer, explanation text, position integer not null,
        created_at timestamptz not null default now(), unique (question_id, position), unique (question_id, client_key)
      );
      create table if not exists quiz_attempts (
        id serial primary key, quiz_id integer not null, quiz_version_id integer not null, user_id integer not null,
        attempt_number integer not null, status text not null default 'in_progress', current_question_key text,
        score double precision not null default 0, category_scores jsonb not null default '{}', result_key text,
        correct_count integer not null default 0, incorrect_count integer not null default 0,
        skipped_count integer not null default 0, visited_question_keys text[] not null default '{}',
        started_at timestamptz not null default now(), completed_at timestamptz, cancelled_at timestamptz,
        timed_out_at timestamptz, voided_at timestamptz, last_activity_at timestamptz not null default now(),
        duration_seconds integer, lock_version integer not null default 0,
        unique (quiz_id, user_id, attempt_number)
      );
      create table if not exists quiz_attempt_answers (
        id serial primary key, attempt_id integer not null, question_key text not null, request_id text not null,
        selected_option_ids text[] not null default '{}', text_value text, number_value double precision,
        structured_value jsonb, score double precision not null default 0, category_scores jsonb not null default '{}',
        is_correct boolean, requires_review boolean not null default false,
        answered_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        unique (attempt_id, question_key), unique (attempt_id, request_id)
      );
      create table if not exists quiz_transitions (
        id serial primary key, attempt_id integer not null, from_question_key text,
        to_question_key text, to_result_key text, trigger jsonb not null default '{}',
        created_at timestamptz not null default now()
      );
      create table if not exists quiz_access_users (
        quiz_id integer not null, user_id integer not null, created_at timestamptz not null default now(),
        primary key (quiz_id, user_id)
      );
      create table if not exists quiz_access_roles (
        quiz_id integer not null, role_key text not null, created_at timestamptz not null default now(),
        primary key (quiz_id, role_key)
      );
      create table if not exists quiz_attempt_adjustments (
        id serial primary key, quiz_id integer not null, user_id integer not null, type text not null,
        amount integer, attempt_id integer, reason text, active boolean not null default true,
        created_by_user_id integer not null, created_at timestamptz not null default now()
      );
      create table if not exists quiz_reports (
        id serial primary key, quiz_id integer not null, reporter_user_id integer not null,
        reason text not null, comment text, status text not null default 'open', resolution text,
        resolved_by_user_id integer, created_at timestamptz not null default now(), resolved_at timestamptz
      );
      create table if not exists quiz_audit_log (
        id serial primary key, quiz_id integer not null, quiz_version_id integer,
        actor_user_id integer, action text not null, metadata jsonb not null default '{}',
        created_at timestamptz not null default now()
      );

      create index if not exists quizzes_status_published_idx on quizzes (status, published_at);
      create index if not exists quizzes_author_updated_idx on quizzes (author_id, updated_at);
      create index if not exists quiz_questions_version_idx on quiz_questions (quiz_version_id);
      create index if not exists quiz_results_version_idx on quiz_results (quiz_version_id);
      create index if not exists quiz_answer_options_question_idx on quiz_answer_options (question_id);
      create index if not exists quiz_attempts_user_activity_idx on quiz_attempts (user_id, last_activity_at);
      create index if not exists quiz_attempts_quiz_status_idx on quiz_attempts (quiz_id, status);
      create index if not exists quizzes_category_idx on quizzes (category_id);
      create index if not exists quiz_versions_quiz_status_idx on quiz_versions (quiz_id, status);
      create index if not exists quiz_attempts_version_idx on quiz_attempts (quiz_version_id);
      create index if not exists quiz_attempt_answers_question_idx on quiz_attempt_answers (question_key);
      create index if not exists quiz_transitions_attempt_created_idx on quiz_transitions (attempt_id, created_at);
      create index if not exists quiz_audit_log_quiz_created_idx on quiz_audit_log (quiz_id, created_at);

      do $$
      declare constraint_row record;
      begin
        if to_regclass('public.site_users') is null then
          raise exception 'site_users table is required before quiz schema setup';
        end if;
        for constraint_row in
          select * from (values
            ('quizzes_author_fk', 'alter table quizzes add constraint quizzes_author_fk foreign key (author_id) references site_users(id) on delete restrict not valid'),
            ('quiz_versions_quiz_fk', 'alter table quiz_versions add constraint quiz_versions_quiz_fk foreign key (quiz_id) references quizzes(id) on delete cascade not valid'),
            ('quiz_versions_creator_fk', 'alter table quiz_versions add constraint quiz_versions_creator_fk foreign key (created_by_user_id) references site_users(id) on delete restrict not valid'),
            ('quiz_questions_version_fk', 'alter table quiz_questions add constraint quiz_questions_version_fk foreign key (quiz_version_id) references quiz_versions(id) on delete cascade not valid'),
            ('quiz_results_version_fk', 'alter table quiz_results add constraint quiz_results_version_fk foreign key (quiz_version_id) references quiz_versions(id) on delete cascade not valid'),
            ('quiz_answer_options_question_fk', 'alter table quiz_answer_options add constraint quiz_answer_options_question_fk foreign key (question_id) references quiz_questions(id) on delete cascade not valid'),
            ('quiz_attempts_quiz_fk', 'alter table quiz_attempts add constraint quiz_attempts_quiz_fk foreign key (quiz_id) references quizzes(id) on delete restrict not valid'),
            ('quiz_attempts_version_fk', 'alter table quiz_attempts add constraint quiz_attempts_version_fk foreign key (quiz_version_id) references quiz_versions(id) on delete restrict not valid'),
            ('quiz_attempts_user_fk', 'alter table quiz_attempts add constraint quiz_attempts_user_fk foreign key (user_id) references site_users(id) on delete restrict not valid'),
            ('quiz_attempt_answers_attempt_fk', 'alter table quiz_attempt_answers add constraint quiz_attempt_answers_attempt_fk foreign key (attempt_id) references quiz_attempts(id) on delete cascade not valid'),
            ('quiz_transitions_attempt_fk', 'alter table quiz_transitions add constraint quiz_transitions_attempt_fk foreign key (attempt_id) references quiz_attempts(id) on delete cascade not valid'),
            ('quiz_access_users_quiz_fk', 'alter table quiz_access_users add constraint quiz_access_users_quiz_fk foreign key (quiz_id) references quizzes(id) on delete cascade not valid'),
            ('quiz_access_users_user_fk', 'alter table quiz_access_users add constraint quiz_access_users_user_fk foreign key (user_id) references site_users(id) on delete cascade not valid'),
            ('quiz_access_roles_quiz_fk', 'alter table quiz_access_roles add constraint quiz_access_roles_quiz_fk foreign key (quiz_id) references quizzes(id) on delete cascade not valid'),
            ('quiz_reports_quiz_fk', 'alter table quiz_reports add constraint quiz_reports_quiz_fk foreign key (quiz_id) references quizzes(id) on delete cascade not valid'),
            ('quiz_audit_log_quiz_fk', 'alter table quiz_audit_log add constraint quiz_audit_log_quiz_fk foreign key (quiz_id) references quizzes(id) on delete cascade not valid')
          ) as constraints(name, statement)
        loop
          if not exists (select 1 from pg_constraint where conname = constraint_row.name) then
            execute constraint_row.statement;
          end if;
        end loop;
      end $$;
    `);
  });
  console.log("quiz tables are ready");
}

main()
  .then(() => client.end())
  .catch(async (error) => {
    console.error(error);
    await client.end({ timeout: 1 }).catch(() => {});
    process.exitCode = 1;
  });
