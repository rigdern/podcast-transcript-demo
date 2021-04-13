import {
  AutocompleteItem,
  AutocompleteResult,
  AutocompleteSettings
} from 'autocompleter';

declare global {
  function autocomplete<T extends AutocompleteItem>(settings: AutocompleteSettings<T>): AutocompleteResult;
}