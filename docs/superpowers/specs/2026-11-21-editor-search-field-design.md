# Editor search field

The editor has more than one search field. Each field used its own border, radius, icon, and focus ring. This note records the shared field.

## Requirement

Every search field in the editor uses `SearchInput`. The fields are the asset list, the blueprint node palette, the canvas node menu, and the character Debug property list. Settings, the blueprint list, and the kit menus have no search field.

## Choices

The asset field and the node field are compact. The Debug field used the large kit input. The shared field follows the compact pair.

- Height is 34 px. The text is 12 px. The line is 18 px. Vertical padding is 7 px. The border is 1 px.
- The border is 1 px, color `--ds-color-border`. The radius is 4 px. The asset field was 5 px. See the open question.
- The icon is the 14 px search mark, on the left, with an 8 px gap. Only the asset field had an icon. The other fields gain the same icon.
- The fill is `--ds-color-input`. The text is `--ds-color-text`. The placeholder is `--ds-color-text-muted` at 60 percent, as on the kit input.
- Focus is a 2 px ring in `--ds-color-focus`, with a 2 px offset. In this app that color is the same as `--ds-color-primary`.
- No field had a clear button. The shared field has none.
- Escape clears the text when the field is not empty. Escape blurs the field when it is empty. In the canvas node menu, Escape closes the menu when the field is empty, and clears the text when it is not.

## Open question

The asset search radius was 5 px. The node search radius was 4 px, and the other compact fields use 4 px. The shared field uses 4 px. Use 5 px if that is the radius you want.
