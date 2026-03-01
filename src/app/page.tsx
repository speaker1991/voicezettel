import { TopBar } from "@/components/layout/TopBar";
import { TopCountersBar } from "@/components/counters/TopCountersBar";
import { ChatArea } from "@/components/chat/ChatArea";
import { OrbArea } from "@/components/orb/OrbArea";
import { InputBar } from "@/components/input/InputBar";
import { AnimationOverlay } from "@/components/counters/FlyingIcon";
import { UserProvider } from "@/components/providers/UserProvider";
import { auth } from "@/lib/auth";

export default async function Home() {
  const session = await auth();

  const userId = session?.user?.email ?? "anonymous";
  const userName = session?.user?.name ?? "";
  const userEmail = session?.user?.email ?? "";

  return (
    <UserProvider userId={userId} userName={userName} userEmail={userEmail}>
      <div className="flex h-dvh flex-col bg-zinc-950">
        <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col min-h-0 px-4">
          <TopBar user={session?.user} />

          <TopCountersBar />

          <OrbArea />

          <ChatArea />

          <InputBar />
        </div>

        <AnimationOverlay />
      </div>
    </UserProvider>
  );
}
