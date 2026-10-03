import { generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { verifyForumPluginOAuth } from "./forumPluginToken";
import { FORUM_PLUGIN_RESOURCE } from "../lib/forum-plugin-contract";
import { WORKOS_GRANT_CLAIM, WORKOS_PLUGIN_GRANT_CLAIM, WORKOS_PLUGIN_KIND_CLAIM, WORKOS_PLUGIN_RESOURCE_CLAIM } from "../lib/workos-config";
const issuer="https://jwt-forum.authkit.app";
let pair:Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async()=>{pair=await generateKeyPair("RS256");});
beforeEach(()=>{vi.stubEnv("WORKOS_CONNECT_ENABLED","true");vi.stubEnv("WORKOS_AUTHKIT_ISSUER",issuer);});
afterEach(()=>vi.unstubAllEnvs());
async function token(overrides:JWTPayload={}) {
  return new SignJWT({iss:issuer,aud:FORUM_PLUGIN_RESOURCE,sub:"human-owner",exp:Math.floor(Date.now()/1000)+60,[WORKOS_PLUGIN_GRANT_CLAIM]:"signed-grant",[WORKOS_PLUGIN_KIND_CLAIM]:"forum-plugin",[WORKOS_PLUGIN_RESOURCE_CLAIM]:FORUM_PLUGIN_RESOURCE,...overrides}).setProtectedHeader({alg:"RS256",kid:"test"}).sign(pair.privateKey);
}
describe("forum JWT signature and resource isolation",()=>{
  test("returns only verified identity and signed grant, never token or download metadata",async()=>{
    expect(await verifyForumPluginOAuth(await token({email:"private@example.test"}),pair.publicKey)).toEqual({issuer,subject:"human-owner",grantId:"signed-grant"});
  });
  test("rejects evidence and multiple audiences even with valid forum claims",async()=>{
    for(const aud of ["https://www.symbaiex.com/api/agent/mcp",[FORUM_PLUGIN_RESOURCE],[FORUM_PLUGIN_RESOURCE,"https://www.symbaiex.com/api/agent/mcp"]])await expect(verifyForumPluginOAuth(await token({aud}),pair.publicKey)).rejects.toThrow("invalid or expired");
  });
  test("rejects expired/not-yet-valid and wrong issuer tokens",async()=>{
    for(const overrides of [{exp:1},{nbf:Math.floor(Date.now()/1000)+60},{iss:"https://other.authkit.app"},{exp:undefined}])await expect(verifyForumPluginOAuth(await token(overrides),pair.publicKey)).rejects.toThrow("invalid or expired");
  });
  test("rejects wrong/missing grant, kind, resource and mixed evidence authorization",async()=>{
    for(const overrides of [{[WORKOS_PLUGIN_GRANT_CLAIM]:undefined},{[WORKOS_PLUGIN_GRANT_CLAIM]:123},{[WORKOS_PLUGIN_KIND_CLAIM]:"evidence"},{[WORKOS_PLUGIN_RESOURCE_CLAIM]:"https://www.symbaiex.com/api/agent/mcp"},{[WORKOS_GRANT_CLAIM]:"old-evidence-grant"}])await expect(verifyForumPluginOAuth(await token(overrides),pair.publicKey)).rejects.toThrow("invalid or expired");
  });
  test("rejects tampered signatures and another signing key",async()=>{
    const signed=await token();const parts=signed.split(".");parts[2]=(parts[2][0]==="A"?"B":"A")+parts[2].slice(1);
    await expect(verifyForumPluginOAuth(parts.join("."),pair.publicKey)).rejects.toThrow("invalid or expired");
    const different=await generateKeyPair("RS256");await expect(verifyForumPluginOAuth(signed,different.publicKey)).rejects.toThrow("invalid or expired");
  });
});
