# Lesson template

This folder is a lesson you can copy. Pry wrote it here the first time it started, and it won't load it as a lesson.

**Copy this folder somewhere of your own before you change it.** Uninstalling Pry can remove its app data, and that includes this lessons folder and anything you wrote in it.

To start:

1. Copy the folder to somewhere like `Documents\my-lessons\`.
2. Rename the folder and the `id` in `lesson.md` to the same new name, like `yourname.first-lesson`. Ids starting `pry.` belong to Pry's own lessons.
3. Change the words. Check it in Pry with Settings > Lessons > **Check this lesson**.
4. Add it with **Add a lesson...** in the lesson list.

The full guide is on GitHub: https://github.com/BeargleIndustries/pry/blob/master/docs/lessons/AUTHORING.md

Writing your own lessons is a preview in Pry 0.4.x. Format 1 lessons will keep opening; when format 2 ships, Pry converts them automatically.

For autocomplete in editors that read YAML schemas, keep this line at the top of the front matter in `lesson.md`:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/BeargleIndustries/pry/master/docs/lessons/schema/pry-front-matter.v1.schema.json
```
