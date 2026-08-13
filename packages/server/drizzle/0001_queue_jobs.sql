CREATE TABLE "impl_queue_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"queue_name" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"data" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category" varchar(30) NOT NULL,
	"type" varchar(100) NOT NULL,
	"priority" varchar(10) DEFAULT 'medium' NOT NULL,
	"title_key" varchar(200) NOT NULL,
	"title_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text,
	"repo_id" text NOT NULL,
	"version_id" text,
	"user_id" text NOT NULL,
	"task_type" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"depends_on" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_contexts" ADD COLUMN "confidence" double precision;--> statement-breakpoint
ALTER TABLE "business_contexts" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "business_contexts" ADD COLUMN "edited_by_human" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "business_contexts" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "business_contexts" ADD COLUMN "source_context_id" text;--> statement-breakpoint
ALTER TABLE "business_contexts" ADD COLUMN "fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "business_contexts" ALTER COLUMN "side_effects" TYPE jsonb USING (
	CASE
		WHEN "side_effects" IS NULL OR "side_effects" = '' THEN '[]'::jsonb
		ELSE to_jsonb("side_effects")
	END
);--> statement-breakpoint
ALTER TABLE "business_contexts" ALTER COLUMN "side_effects" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_tasks" ADD CONSTRAINT "repo_tasks_job_id_impl_queue_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."impl_queue_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_tasks" ADD CONSTRAINT "repo_tasks_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_tasks" ADD CONSTRAINT "repo_tasks_version_id_repo_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."repo_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_tasks" ADD CONSTRAINT "repo_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_tasks" ADD CONSTRAINT "repo_tasks_depends_on_repo_tasks_id_fk" FOREIGN KEY ("depends_on") REFERENCES "public"."repo_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "impl_queue_jobs_status_available_idx" ON "impl_queue_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "impl_queue_jobs_queue_status_idx" ON "impl_queue_jobs" USING btree ("queue_name","status");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_user_category_idx" ON "notifications" USING btree ("user_id","category","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "repo_tasks_repo_status_idx" ON "repo_tasks" USING btree ("repo_id","status");--> statement-breakpoint
CREATE INDEX "repo_tasks_user_idx" ON "repo_tasks" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "repo_tasks_type_status_idx" ON "repo_tasks" USING btree ("task_type","status");
