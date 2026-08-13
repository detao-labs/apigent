"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Textarea,
} from "@apigent/ui";
import type { OrgSummary } from "@/services/orgs";

export function RepoForm({ orgs }: { orgs: OrgSummary[] }) {
  const t = useTranslations("repos.new");
  const errors = useTranslations("repos.new.errors");
  const router = useRouter();

  const [orgId, setOrgId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          name,
          description: description.trim() || undefined,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { repo?: { id: string } };
        router.push(`/repos/${data.repo?.id ?? ""}`);
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (data?.error === "org-not-found") {
        setError(errors("orgNotFound"));
      } else if (res.status === 400) {
        setError(errors("invalid"));
      } else {
        setError(errors("generic"));
      }
    } catch {
      setError(errors("generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("details")}</CardTitle>
        <CardDescription>{t("detailsDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label htmlFor="orgId" className="text-sm font-medium">
              {t("org")}
            </label>
            <select
              id="orgId"
              name="orgId"
              required
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              disabled={orgs.length === 0}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">{t("orgPlaceholder")}</option>
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              <Link
                href="/orgs/new"
                className="underline underline-offset-4 hover:text-primary"
              >
                {t("createOrg")}
              </Link>{" "}
              {t("orgHint")}
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              {t("name")}
            </label>
            <Input
              id="name"
              name="name"
              type="text"
              required
              maxLength={255}
              placeholder={t("namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="description" className="text-sm font-medium">
              {t("descriptionLabel")}
            </label>
            <Textarea
              id="description"
              name="description"
              rows={3}
              placeholder={t("descriptionPlaceholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <p className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              i
            </span>
            {t("importNote")}
          </p>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={submitting || orgs.length === 0}>
              {t("submit")}
            </Button>
            <Link href="/repos" className={buttonVariants({ variant: "ghost" })}>
              {t("cancel")}
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
