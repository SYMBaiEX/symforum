import { createRoot } from "react-dom/client";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import { ForumMediaGallery } from "../../../components/forum/forum-media-gallery";
import { useAttachments } from "./gallery-original-image-state";
function Fixture() {
  const attachments = useAttachments();
  return (
    <main data-surface="forum" className="forum-app-shell p-4">
      <h1>Isolated gallery</h1>
      <ForumMediaGallery attachments={attachments} />
      <button>After gallery</button>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <Fixture />
  </SurfaceScope.Provider>,
);
