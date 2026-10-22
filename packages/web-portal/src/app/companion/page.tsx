import type { Metadata } from "next";
import { CompanionApp } from "@/components/companion-app";

export const metadata: Metadata = {
  title: "FreshFlite Companion | Coastal Packout",
  description: "NFC and BLE field packout for Ibom Air cold-chain pods.",
};

export default function CompanionPage() {
  return <CompanionApp />;
}
