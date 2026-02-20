import { TopBar } from "@/components/layout/TopBar";
import { ChatArea } from "@/components/chat/ChatArea";
import { OrbArea } from "@/components/orb/OrbArea";
import { InputBar } from "@/components/input/InputBar";

export default function Home() {
  return (
    <div className="flex h-dvh flex-col bg-zinc-950">
      <TopBar />

      <ChatArea />

      <OrbArea />

      <InputBar />
    </div>
  );
}
