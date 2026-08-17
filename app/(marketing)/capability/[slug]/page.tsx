import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingCapabilityDetail } from "@/components/landing-capability-detail";
import { capabilityDetailConfig } from "@/lib/landing-content";

export function generateStaticParams() {
  return Object.keys(capabilityDetailConfig.capabilities).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = capabilityDetailConfig.capabilities[slug];
  if (!data) return { title: "E-Irene" };
  return {
    title: `${data.title} — E-Irene`,
    description: data.subtitle,
  };
}

export default async function CapabilityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = capabilityDetailConfig.capabilities[slug];
  if (!data) notFound();

  return <LandingCapabilityDetail slug={slug} data={data} />;
}
