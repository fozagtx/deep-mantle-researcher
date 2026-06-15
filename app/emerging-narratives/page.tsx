import type { Metadata } from "next";
import { getTranslations } from "@/lib/copy";
import EmergingNarrativesClient from "./EmergingNarrativesClient";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ namespace: "emergingNarratives" });
  const tMeta = await getTranslations({ namespace: "metadata" });
  const siteLine = tMeta("title");
  const brand = siteLine.split("—")[0]?.trim() ?? "Branium";
  const pageTitle = `${t("title")} · ${brand}`;

  return {
    title: pageTitle,
    description: t("lead"),
    openGraph: {
      title: pageTitle,
      description: t("lead"),
    },
  };
}

export default function EmergingNarrativesPage() {
  return <EmergingNarrativesClient />;
}
