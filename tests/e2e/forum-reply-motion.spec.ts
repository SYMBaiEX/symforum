import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
let script: string;
test.beforeAll(() => {
  const source = `import {focusForumReplyComposer} from './components/forum/forum-reply-motion';const moves=[];window.replyMotionFixture=moves;const composer=document.getElementById('composer');const editor=document.getElementById('editor');composer.scrollIntoView=(options)=>moves.push(options);document.getElementById('quote').onclick=()=>focusForumReplyComposer(composer,editor,'start');document.getElementById('reply').onclick=()=>focusForumReplyComposer(composer,editor,'center');`;
  script = execFileSync("bun", ["-e", `const result=await Bun.build({entrypoints:['reply-motion-fixture'],target:'browser',format:'iife',plugins:[{name:'isolated-motion',setup(build){build.onResolve({filter:/^reply-motion-fixture$/},()=>({path:'reply-motion-fixture',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:${JSON.stringify(source)},loader:'ts',resolveDir:process.cwd()}));}}]});if(!result.success)throw new Error(JSON.stringify(result.logs));process.stdout.write(await result.outputs[0].text());`], { encoding: "utf8" });
});
declare global { interface Window { replyMotionFixture: ScrollIntoViewOptions[] } }
for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`reply jumps preserve keyboard focus and draft with ${reducedMotion} motion`, async ({ page }) => {
    const unexpected: string[] = [];
    await page.emulateMedia({ reducedMotion });
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === "http://127.0.0.1:43230" && url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<button id="quote">Quote</button><button id="reply">Reply</button><section id="composer"><label>Reply draft<textarea id="editor">Draft stays intact</textarea></label></section><script src="/fixture.js"></script>' });
      if (url.origin === "http://127.0.0.1:43230" && url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: script });
      unexpected.push(url.href);
      return route.abort();
    });
    await page.goto("http://127.0.0.1:43230/");
    await page.getByRole("button", { name: "Quote", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Reply draft" })).toBeFocused();
    await expect(page.getByRole("textbox", { name: "Reply draft" })).toHaveValue("Draft stays intact");
    await page.getByRole("button", { name: "Reply", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Reply draft" })).toBeFocused();
    const behavior = reducedMotion === "reduce" ? "instant" : "smooth";
    expect(await page.evaluate(() => window.replyMotionFixture)).toEqual([{ block: "start", behavior }, { block: "center", behavior }]);
    await expect(page.getByRole("textbox", { name: "Reply draft" })).toHaveValue("Draft stays intact");
    expect(unexpected).toEqual([]);
  });
}
