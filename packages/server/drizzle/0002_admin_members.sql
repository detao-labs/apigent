CREATE TABLE "admin_members" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" varchar(32) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" text
);
--> statement-breakpoint
ALTER TABLE "admin_members" ADD CONSTRAINT "admin_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_members" ADD CONSTRAINT "admin_members_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_members_role_idx" ON "admin_members" USING btree ("role");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "is_platform_admin";