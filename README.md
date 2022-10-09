# matches
Matches for a lot of Minecraft versions.

This uses [mc-versions](https://github.com/skyrising/mc-versions) as its source of versions. This way it is based on a version graph that includes all publicly released versions, even if they're not available through the Minecraft launcher.

## Contributing
If you want to contribute new matches please use [my customized version of Matcher](https://github.com/skyrising/matcher), since it has some nice improvements and also includes the match status in the match files it outputs.

Contact me on Discord (skyrising#1562) to avoid wasting time by unknowingly matching the same versions separately.

Run
```sh
./match.ts next
```
to generate the jars and a template for the next missing match or
```sh
./match.ts <version-a> <version-b>
```
to do so for a specific pair of versions.

After pulling matches created by others you can run
```sh
./match.ts refresh
```
to generate all the jars for existing matches, that way you can open them in Matcher.