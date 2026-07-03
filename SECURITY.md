# Security policy

## Reporting a vulnerability

Please report security issues privately, not in a public issue.

Use GitHub's private vulnerability reporting: open the repository's **Security**
tab and choose **Report a vulnerability**. That opens a private advisory visible
only to the maintainers.

Include what you can reproduce: the browser and version, the LinkSweepr version,
the steps, and the impact you observed. You will get an acknowledgement, and a
fix or an explanation of why the behavior is expected.

## Scope

LinkSweepr runs entirely on your device. It makes no network requests, sends no
telemetry, and stores only the domain list you enter, in `chrome.storage.local`.
There is no server, no account, and no remote code. So the security surface is
the extension itself: how it reads and deletes browsing history, how it matches
domains, and how it handles the list you provide.

Reports that are in scope include, for example:

- A way to make LinkSweepr delete history it should not, or fail to delete
  history it should, in a way that could mislead a user about what is stored.
- A parsing or matching flaw in domain handling that a crafted list entry or URL
  could exploit.
- Any path by which extension data could leave the device.

Out of scope: issues in Edge or Chrome themselves, and general browser history
behavior that is not specific to LinkSweepr.

## Supported versions

The latest published release is supported. Because the extension is small and
ships from one codebase to both stores, fixes go into the next release rather
than into back-ported patch lines.
