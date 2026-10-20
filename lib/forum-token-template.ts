export const TOKEN_POST_TEMPLATE = `## Token overview
**Project / token name:** 
**Ticker:** 
**Chain:** 
**Contract / mint address:** 
**Official token page (Bags link for Bags tokens):** 
**Website / official socials:** 
**Explorer link:** 

## What is it?
[Explain the project, what the token does, and why it exists.]

## Fees and funding
[Who receives fees, at what rate, and how are they intended to be used? Link evidence.]

## Token and liquidity details
[Supply, holder concentration, liquidity/locks, mint/freeze authorities, and audit status. Link sources and mark anything unverified as unknown.]

## Your connection
[Are you the creator, team, a holder, or a paid promoter? Disclose affiliations, compensation, and relevant holdings.]

## Risks and limitations
[Known risks, dependencies, and what has not been verified. No guaranteed returns.]

## Sources and updates
[Link primary sources with the date checked. Keep future updates in this thread.]`;

export function getForumTokenTemplate(categorySlug: string) {
  return categorySlug === "crypto" || categorySlug === "crypto-bags"
    ? TOKEN_POST_TEMPLATE
    : undefined;
}
