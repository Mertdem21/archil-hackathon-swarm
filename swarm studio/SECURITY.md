# Local demo security

The demo opens a local session on a loopback origin. Keep it bound to localhost and keep provider keys in the ignored `.env` file.

Use a disposable test app for QA. Swarm workers run in Archil and can reach targets available from their sandboxes.
