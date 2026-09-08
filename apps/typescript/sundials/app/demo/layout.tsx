import { HarborShell } from "./HarborShell";

export const metadata = {
  title: "Harbor CRM",
  description: "The CRM for high-ticket revenue teams. Pipeline, marketing, and service in one operating system."
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <HarborShell>{children}</HarborShell>;
}
