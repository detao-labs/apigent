"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  buttonVariants,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@apigent/ui";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import type { OrgSummary } from "@/services/orgs";

export function OrgsTable({ orgs }: { orgs: OrgSummary[] }) {
  const t = useTranslations("orgs");
  const router = useRouter();

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/50 hover:bg-muted/50">
          <TableHead>{t("table.name")}</TableHead>
          <TableHead className="text-right">{t("table.members")}</TableHead>
          <TableHead className="text-right">{t("table.repos")}</TableHead>
          <TableHead className="text-right">{t("table.actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orgs.map((org) => (
          <TableRow
            key={org.id}
            className="cursor-pointer"
            onClick={() => router.push(`/repos?org=${org.id}`)}
          >
            <TableCell className="font-medium">{org.name}</TableCell>
            <TableCell className="text-right tabular-nums">
              {org.memberCount}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {org.repoCount}
            </TableCell>
            <TableCell className="text-right">
              <Link
                href={`/repos?org=${org.id}`}
                onClick={(e) => e.stopPropagation()}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                <ExternalLink className="size-3" />
                {t("table.viewRepos")}
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
