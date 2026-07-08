import { requireUser } from "@/lib/auth";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { UserMenu } from "@/components/user-menu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-dvh bg-cloud">
      <AppSidebar role={user.role} clinicName={user.clinicName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-gray-line bg-card px-4 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <MobileNav role={user.role} clinicName={user.clinicName} />
            <span className="font-heading font-semibold text-navy">E-Irene</span>
          </div>
          <div className="flex flex-1 items-center justify-end gap-4">
            <UserMenu user={user} />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
