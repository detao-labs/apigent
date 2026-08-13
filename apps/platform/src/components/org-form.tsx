"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PageContainer } from "@/components/page-container";
import {
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@apigent/ui";

export function OrgForm() {
  const t = useTranslations("orgs.new");
  const errors = useTranslations("orgs.new.errors");
  const router = useRouter();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, slug }),
      });
      if (res.ok) {
        router.push("/orgs");
        router.refresh();
        return;
      }
      if (res.status === 409) setError(errors("slugTaken"));
      else if (res.status === 400) setError(errors("invalid"));
      else setError(errors("generic"));
    } catch {
      setError(errors("generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("details")}</CardTitle>
          <CardDescription>{t("detailsDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                {t("name")}
              </label>
              <Input
                id="name"
                name="name"
                type="text"
                required
                placeholder={t("namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="slug" className="text-sm font-medium">
                {t("slug")}
              </label>
              <Input
                id="slug"
                name="slug"
                type="text"
                required
                pattern="[a-z0-9-]+"
                placeholder={t("slugPlaceholder")}
                className="font-mono"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("slugHint")}</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center gap-3 pt-4">
              <Button type="submit" disabled={submitting}>
                {t("submit")}
              </Button>
              <Link href="/orgs" className={buttonVariants({ variant: "ghost" })}>
                {t("cancel")}
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
    </PageContainer>
  );
}
