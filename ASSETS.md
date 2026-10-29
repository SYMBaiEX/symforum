# Brand and media notices

The root MIT license covers the application source code and original technical
documentation. Existing package licenses and third-party license notices remain
in effect.

SYMBaiEX and SYMBaiEX Forum names, logos, mascots and character portraits identify
this project. The code license does not grant trademark rights, endorsements or
permission to represent a fork as an official SYMBaiEX service. Use your own
identity and accounts when deploying a fork.

Brand artwork under `brand/`, `assets/`, `public/images/` and app-specific public
image directories is excluded from the root MIT grant unless a file-specific
notice says otherwise. Obtain permission before reusing it as your own branding.

News photographs, meme templates, reaction GIFs, source screenshots, user posts
and other third-party content retain their respective rights. A cached copy or
source URL does not confer a license. Preserve required attribution; do not assume
all media in this repository or returned by an integration is freely reusable.
Runtime content from providers is not part of the source-code license.

README screenshots illustrate the project's public interface. They do not grant
rights to the underlying user content, source imagery or brand marks. For your
own distribution, replace them with screenshots from your deployment or obtain
the relevant permissions.

Dependencies, bundled fonts and maintained compatibility patches retain their
upstream licenses. Review those licenses when redistributing a build.

Bundled Geist and Geist Mono fonts are distributed under SIL OFL 1.1; the notice
is included in each font directory. KaTeX's bundled assets retain the notice at
`public/fonts/KaTeX-LICENSE.txt`.

## Source and notice inventory

| Files                                                                   | Recorded source and redistribution boundary                                                                                                                                                                                        |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brand/` and `public/images/brand/`                                     | Project identity artwork and derivatives. Generation and export notes are in `brand/README.md` and `brand/symforum-2026-10-20/README.md`. Reserved brand rights above apply.                                                       |
| `assets/telegram/`                                                      | Project-generated mascot media, captions and rendered exports. Prompts and source notes are in `assets/telegram/README.md` and `assets/telegram/cinematic/README.md`. Reserved brand rights apply.                                 |
| HyperFrames examples in `assets/telegram/cinematic/compositions/`       | Upstream registry code from HyperFrames v0.8.209. The retained Apache-2.0 license is `assets/telegram/cinematic/HyperFrames-LICENSE.txt`; the cinematic README identifies the adapted examples. Upstream terms apply to this code. |
| `assets/fonts/`, `public/fonts/` and cinematic font directories         | Retained Geist/Geist Mono OFL notices and the KaTeX license. Font conversion does not replace the upstream license.                                                                                                                |
| `docs/screenshots/`                                                     | Signed-out product screenshots for documentation. Underlying branding and depicted content keep their existing rights.                                                                                                             |
| Legacy banners, portraits and pet sprites elsewhere in `public/images/` | Existing project media with no separate reusable-media grant. These files are not offered under the code's MIT license; forks should replace them.                                                                                 |

External meme templates, GIFs and article imagery fetched at runtime remain
provider content, not newly licensed source assets. Do not add cached provider
media to a source release merely because an integration can download it.
