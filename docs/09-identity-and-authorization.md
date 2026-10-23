# 09 · Identity and authorization (draft)

Notes from a discussion on 2026-10-23. Nothing here is built. This is separate from the control layer on AWS ([08-aws-control-layer](08-aws-control-layer.md)). Items marked **(guess)** or **(unverified)** were not confirmed by the project owner or against current docs. The Entra, GitHub and Atlassian details come from general knowledge, not from reading their current docs, unless a source is given.

## Principles from the project owner

1. The bot is not for everyone. Only allowed people can trigger it from Jira, GitHub or Teams. Identity comes from Entra, with its users and groups.
2. Even an allowed person must not get more through the bot than they could do themselves. The bot must not override the caller's permission level.

## Today

- GitHub: the mention author's access on the repo is read from GitHub. `write` or higher is required (`GithubBot.ts`, `respondToMentionAccess`). Denied: a 👎 reaction and one "maintainers only" comment.
- Jira: no check. `authorizeJiraMention` in `JiraBot.ts` returns `true`. The README says a Jira permission check is deferred.
- The signature check (is the message really from the provider) is separate. It is library code and platform-independent.

## Two gates, two owners **(guess)**

```text
comment in GitHub / Jira / Teams
   -> who is this?                  provider identity -> Entra person
   -> Gate 1: may they use the bot?  Entra decides (a central list)
   -> Gate 2: what may the bot do FOR them?   the channel decides (GitHub / Jira permissions)
```

Entra cannot tell what someone may do in GitHub or Jira. Those permissions live in the providers.

Gate 1 in Entra terms: the bot is an app registration (an Enterprise Application) with an app role such as `Bot.Use`, assigned to an Entra group. "Allowed" means "in that group". Removing someone from the group stops them at once, provided membership is read live (short cache at most).

Gate 2 uses the providers' own delegation: GitHub App user tokens, and Atlassian OAuth tokens that act as the user. The bot's own service account must not be what the agent uses. **(unverified)**

For the current scope (control layer, echo stub), only Gate 1 and carrying the caller's identity with the request are testable. The existing seam is `authorizeJiraMention` and the GitHub access check: one function that returns allow or deny **plus the caller's identity**. Build it first with a fixed allowlist.

## Linking a provider account to an Entra person

| Option | How | Weak point |
|---|---|---|
| A. Match by email | Commenter's email equals the Entra email | GitHub emails are often private; Jira can hide them; easiest to fake |
| B. Provider SSO with Entra | The provider knows the Entra identity | Enterprise plans, per-provider APIs, not checked |
| C. A link table | Provider id to Entra person; admin-filled at first, self-service later | Someone maintains it |
| D. Teams | Teams messages carry the Entra user id | Teams only |

The owner dislikes maintaining a mapping per channel by hand. Direction: a portal where people sign in with Entra and connect their Jira and GitHub accounts themselves (OIDC sign-in, then the provider's OAuth). The person proves both identities, so no admin table and no email guess. **(guess, the exact flow is not designed)**

UX options shown as wireframes (no choice recorded):
- A. Portal first: connect before using the bot.
- B. Just in time: when an unknown person mentions the bot, it replies with a connect link; after Entra sign-in and the provider authorization the request starts by itself. The provider sign-in must stay in the flow, because a public link alone cannot prove who clicked it.
- C. Both (the assistant's pick): the portal shows status, the bot's reply is the fallback.

## Where the link is stored **(guess)**

Not in Entra, and not in Azure. Entra is an identity service, Azure is a cloud, and a portal on AWS can use "Sign in with Entra" (OIDC). Our own table, in DynamoDB on AWS:

```text
key:    provider + stable provider user id   (GitHub numeric id, Jira account id; not login or email)
value:  entra tenant id + entra object id, linkedAt, displayName (for humans only)
        token reference (encrypted secret store; tokens never in the table)
second lookup: entra object id -> their links
```

The link only says who someone is. Whether they may use the bot is read live from the Entra group, so a stale link for a person who left is harmless.

Entra custom attributes could hold the link, but it needs a powerful directory-write permission and is a poor place for GitHub and Jira ids. Not recommended. **(guess; limits not verified)**

## Cloning repos with the GitHub App identity **(unverified)**

The App's installation token can reach every repo the App is installed on, so by default the bot can exceed the caller. Enforce by the credential the agent holds, not by the agent's behaviour:

| Option | How | Cost |
|---|---|---|
| 1. Whole installation token | Use the App token as is | Wrong |
| 2. Check, then a narrow token | Check the caller's permission on the repo, then mint an installation token limited to that repo (read-only if enough) | No user tokens stored; repo level only |
| 3. Act as the user | Use the person's GitHub App user token from the connect step; limited to what both the App and the user can do | Store and refresh user tokens |

A combination works too: use the user token only to list the repos they can reach, then mint a short-lived installation token narrowed to that set. Open checks: whether a user token works for HTTPS clone, how organisation SAML SSO affects the permission check, token lifetimes and narrowing limits.

This belongs to the later agent work.

## Testing with a personal Azure account **(partly verified through web search on 2026-10-23)**

- A personal Microsoft account signed in to the Azure portal lands in the shared Microsoft Services tenant, which restricts app registration. Sign up at azure.microsoft.com/free in a private window and create your own tenant. You become its Global Administrator. A third-party guide says the signup needs a phone number and a card (a temporary $1 hold, reversed). Not confirmed by Microsoft.
- Group-based app assignment needs Entra ID P1 or P2, per Microsoft Learn. On Free, assign users one by one. A third-party page lists P1 at about $7 per user per month.
- Not verified: whether app registration and sign-in are free in the new tenant (expected), group claims in tokens, app roles, whether a Graph group-membership check works on Free and what permission it needs, any P1 trial.
- Test plan **(guess)**: test users plus a group such as `bot-users`; the bot asks Microsoft Graph whether the signed-in person is in the group.

Sources: [groups for SaaS app assignment](https://learn.microsoft.com/nb-no/Entra/identity/users/groups-saasapps), [no default tenant assigned](https://learn.microsoft.com/en-us/answers/questions/1343236/no-default-tenant-assigned), [Explore Microsoft Entra ID](https://learn.microsoft.com/en-us/training/modules/explore-identity-services/3-explore-azure-active-directory-azure-ad), [Entra licensing guide (third party)](https://redresscompliance.com/microsoft-entra-id-licensing-guide.html), [free-tier Entra tenant guide (third party)](https://help.trugrid.com/en/article/how-to-create-a-free-tier-entraid-tenant-to-use-for-securerdp-3jczbd/).

## Open questions

- Should the agent ever act as the person (open PRs, push under their name), or always as the bot on their behalf? This decides GitHub option 2 or 3.
- First AWS test: a fixed allowlist, with Entra added once the control layer works, or fold the Entra group check into the first version?
- Where will the portal be hosted?
- What should happen to a denied request: the GitHub behaviour (👎 and one notice), or silence?
- Jira: which API and rule for a permission check. An allowlist of Jira account ids is the simplest.
- Which UX option for connecting accounts.
