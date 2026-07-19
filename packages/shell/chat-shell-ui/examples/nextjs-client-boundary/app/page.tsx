import {ChatShellManifestSchema} from "@dromio/chat-shell-ui/chat-shell-contracts/v1";

import {ChatShellClient} from "./ChatShellClient";
import {createServerManifest} from "../lib/createServerManifest";

export default async function Page() {
  const manifest = ChatShellManifestSchema.parse(await createServerManifest());

  return <ChatShellClient initialManifest={manifest} />;
}
