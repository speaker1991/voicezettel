import { TopBar } from "@/components/layout/TopBar";
import { MainLayout } from "@/components/layout/MainLayout";
import { UserProvider } from "@/components/providers/UserProvider";
import { GlobalErrorLogger } from "@/components/providers/GlobalErrorLogger";
import { auth } from "@/lib/auth";

export default async function Home() {
  const session = await auth();

  const userId = session?.user?.email ?? "anonymous";
  const userName = session?.user?.name ?? "";
  const userEmail = session?.user?.email ?? "";

  return (
    <UserProvider userId={userId} userName={userName} userEmail={userEmail}>
      <GlobalErrorLogger />
      <MainLayout topBar={<TopBar user={session?.user} />} />
    </UserProvider>
  );
}
