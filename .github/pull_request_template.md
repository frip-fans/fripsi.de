## Change

Describe the resulting behavior and why it is needed.

## Validation

- [ ] CI passes.
- [ ] Tested in staging before release to master.
- [ ] For production releases: release branch starts at current master, matches the accepted staging tree, and uses rebase merge under existing protection rules.
- [ ] Database impact assessed: no change, migration, or a separate content update.

For database changes, describe the migration order and any production content updates. Merging code does not copy staging data into production.
