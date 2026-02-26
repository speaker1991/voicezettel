import { TopBar } from "@/components/layout/TopBar";
import { ChatArea } from "@/components/chat/ChatArea";
import { OrbArea } from "@/components/orb/OrbArea";
import { InputBar } from "@/components/input/InputBar";

export default function Home() {
  return (
    <div className="flex h-dvh flex-col bg-zinc-950">
      <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col min-h-0 px-4">
        <TopBar />

        <ChatArea />

        <OrbArea />

        <InputBar />
      </div>
    </div>
  );
}
