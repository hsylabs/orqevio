CREATE TABLE "instance" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"owner_id" uuid NOT NULL,
	"access_key_hash" text NOT NULL,
	"setup_code_hash" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_single_row" CHECK ("instance"."id" = 1)
);
--> statement-breakpoint
DROP INDEX "users_email_idx";--> statement-breakpoint
-- Sessions from the account-based sign-in are closed: the copy has to be claimed with the setup code.
DELETE FROM "sessions";--> statement-breakpoint
ALTER TABLE "instance" ADD CONSTRAINT "instance_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";