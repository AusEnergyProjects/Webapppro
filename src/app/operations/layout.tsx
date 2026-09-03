import { ProtectedWorkspaceStyles } from "@/components/ProtectedWorkspaceStyles";

export default function OperationsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <><ProtectedWorkspaceStyles />{children}</>;
}
