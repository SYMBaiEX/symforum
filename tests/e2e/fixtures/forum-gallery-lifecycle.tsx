import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SurfaceScope } from "../../../components/ui/surface-scope";
import {
  ForumMediaGallery,
  type ForumMediaAttachment,
} from "../../../components/forum/forum-media-gallery";

const files: Record<string, ForumMediaAttachment> = Object.fromEntries(
  ["A", "B", "C"].map((id) => [
    id,
    {
      _id: id,
      filename: `${id}.png`,
      altText: `Illustration ${id}`,
      contentType: "image/png",
      size: 1234,
      url: `https://gallery.invalid/${id}.png`,
    },
  ]),
);
const unsafe = [
  {
    _id: "unsafe",
    filename: "unsafe.png",
    contentType: "image/png",
    size: 1,
    url: "javascript:alert(1)",
  },
  {
    _id: "credentials",
    filename: "credentials.png",
    contentType: "image/png",
    size: 1,
    url: "https://member:secret@gallery.invalid/private.png",
  },
];
function Fixture() {
  const [ids, setIds] = useState(["A", "B", "C"]);
  useEffect(() => {
    const change = (event: Event) =>
      setIds((event as CustomEvent<string[]>).detail);
    window.addEventListener("gallery:set", change);
    return () => window.removeEventListener("gallery:set", change);
  }, []);
  return (
    <main
      data-surface="forum"
      className="forum-app-shell"
      style={{ padding: 16 }}
    >
      <h1>Local gallery fixture</h1>
      <ForumMediaGallery
        attachments={[...ids.map((id) => files[id]), ...unsafe]}
      />
      <button>After gallery</button>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <SurfaceScope.Provider value="forum">
    <Fixture />
  </SurfaceScope.Provider>,
);
