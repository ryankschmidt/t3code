# Mac ThroughLine installer

> i've ruled that i only want the last successful throughline build on my mac and the previous builds to be archived on my external hard drive. that was supposed to be written into all associated processes and workflows and tools so agents continued the archiving when new installs landed

Both the release pipeline and desktop-platform-install.ts route through install-mac.sh. It checks archive availability before quitting the app and calls the installed throughline-ship archive adapter after successful startup checks. The final install PASS is withheld until archiving succeeds. Failed archives retain the Mac copies. Store backups are not build artifacts and are not pruned by this rule.
