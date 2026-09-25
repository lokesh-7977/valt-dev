import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageContainer, PageHeader } from "@/components/layout/page";

import { KitGallery } from "./kit-gallery";

export const metadata: Metadata = { title: "UI kit" };

/** Dev-only gallery of every reusable block. Hidden in production builds. */
export default function KitPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Dev only"
        title="UI kit"
        description="Every reusable building block, live. Copy from here when composing new screens."
      />
      <KitGallery />
    </PageContainer>
  );
}
