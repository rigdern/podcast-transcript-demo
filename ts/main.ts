// Example URL you can navigate to: index.html?collectionId=1446336657&episodeGuid=Buzzsprout-8212589

let player: HTMLAudioElement = undefined;
let searchEl: HTMLInputElement = undefined;
let currentDialogue: IDialogueWithEnd = undefined;
let dialogue: IDialogueWithEnd[] = [];
let selectedTab: 'description' | 'transcript' = 'transcript';

function removeChildren(parent: HTMLElement) {
  while (parent.childElementCount > 0) {
    parent.removeChild(parent.firstElementChild);
  }
}

function initEl<T extends HTMLElement>(element: T, attributes?: {[name: string]: string}, children?: Node[]): T {
  if (attributes) {
    Object.keys(attributes).forEach(attribute => {
      element.setAttribute(attribute, attributes[attribute]);
    });
  }

  if (children) {
    children.forEach(child => {
      element.appendChild(child);
    });
  }

  return element;
}

function text(content: string) {
  return document.createTextNode(content);
}

function el(tagName: string, attributes?: {[name: string]: string}, children?: Node[]) {
  return initEl(document.createElement(tagName), attributes, children);
}

function a(attributes?: {[name: string]: string}, children?: Node[]): HTMLAnchorElement {
  return initEl(document.createElement('a'), attributes, children);
}

function audio(attributes?: {[name: string]: string}, children?: Node[]): HTMLAudioElement {
  return initEl(document.createElement('audio'), attributes, children);
}

function div(attributes?: {[name: string]: string}, children?: Node[]): HTMLDivElement {
  return initEl(document.createElement('div'), attributes, children);
}

function input(attributes?: {[name: string]: string}, children?: Node[]): HTMLInputElement {
  return initEl(document.createElement('input'), attributes, children);
}

function p(attributes?: {[name: string]: string}, children?: Node[]): HTMLParagraphElement {
  return initEl(document.createElement('p'), attributes, children);
}

function pp(json: any) {
  return JSON.stringify(json, null, 2);
}

function last<T>(array: T[]) {
  return array[array.length - 1];
}

function mapNodeList<TIn extends Node, TOut>(nodeList: NodeListOf<TIn>, callback: (node: TIn) => TOut): TOut[] {
  const result: TOut[] = [];
  nodeList.forEach(node => {
    result.push(callback(node));
  });

  return result;
}

function partitionWhen<T>(array: T[], fn: (item: T) => boolean) {
  const result = [];

  array.forEach(item => {
    if (fn(item)) {
      result.push([item]);
    } else {
      if (result.length === 0) result.push([]);
      result[result.length - 1].push(item);
    }
  });

  return result;
}

function getEpisodeByGuid(doc: Document, episodeGuid: string) {
  const it = doc.evaluate('.//channel/item/guid', doc, xmlNamespaceResolver, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
  for (let guidElement = it.iterateNext(); guidElement; guidElement = it.iterateNext()) {
    if (guidElement.textContent === episodeGuid) {
      const episodeElement = guidElement.parentElement;
      return episodeElement;
    }
  }

  throw new Error('Could not find episode with GUID: ' + episodeGuid);
}

interface IEpisode {
  guid: string;
  title: string;
  publicationDate: Date;
  audio: {
    type: string;
    url: string;
  }
  description: string;
  encoded: string; // This name is taken from the RSS format. Perhaps we should user a clearer name here.
  transcriptUrl: string;
  chaptersUrl: string;
}

interface IPodcast {
  collectionId: number;
  title: string;
  episodes: IEpisode[];
}

function xmlNamespaceResolver(namespace) {
  const namespaces = {
    content: 'http://purl.org/rss/1.0/modules/content/',
    podcast: 'https://podcastindex.org/namespace/1.0',
  };

  const result = namespaces[namespace];
  if (!result) throw new Error('Unexpected namespace: ' + namespace);

  return result;
}

function parseEpisode(doc: Document, episode: Element): IEpisode {
  const enclosure = episode.querySelector('enclosure');

  return {
    guid: episode.querySelector('guid').textContent,
    title: episode.querySelector('title').textContent,
    publicationDate: new Date(episode.querySelector('pubDate').textContent),
    audio: {
      type: enclosure.getAttribute('type'),
      url: enclosure.getAttribute('url'),
    },
    description: doc.evaluate('.//description', episode, xmlNamespaceResolver, XPathResult.STRING_TYPE, null).stringValue,
    encoded: doc.evaluate('.//content:encoded', episode, xmlNamespaceResolver, XPathResult.STRING_TYPE, null).stringValue,
    transcriptUrl: doc.evaluate('.//podcast:transcript[@type=\'application/json\']/@url', episode, xmlNamespaceResolver, XPathResult.STRING_TYPE, null).stringValue,
    chaptersUrl: doc.evaluate('.//podcast:chapters[@type=\'application/json\']/@url', episode, xmlNamespaceResolver, XPathResult.STRING_TYPE, null).stringValue,
  };
}

function parsePodcast(collectionId: number, doc: Document): IPodcast {
  const channel = doc.querySelector('channel');

  return {
    collectionId: collectionId,
    title: channel.querySelector('title').textContent,
    episodes: undefined
  };
}

// Podcast Index transcript
//

interface IPISegment {
  speaker: string;
  startTime: number;
  body: string;
}

interface IPITranscript {
  segments: IPISegment[];
}

// Transcript
//

interface IDialogue {
  index: number;
  startTime: number;
  body: string;
}

interface IDialogueWithEnd extends IDialogue {
  endTime: number;
}

interface ISegment {
  speaker: string;
  dialogue: IDialogue[];
}

interface ITranscript {
  segments: ISegment[];
}

// Chapter
//

interface IChapter {
  index: number;
  title: string;
  startTime: number;
}

interface IChapters {
  chapters: IChapter[];
}

// Wrappers
//

type ISpeakerOrChapterSegment =
  { type: 'speaker', value: ISegment } |
  { type: 'chapter', value: IChapter };

interface ITranscriptWithSpeakersAndChapters {
  segments: ISpeakerOrChapterSegment[];
}

function assertTranscriptIsMonotonic(transcript: ITranscriptWithSpeakersAndChapters): ITranscriptWithSpeakersAndChapters {
  let time = -1;
  transcript.segments.forEach(segment => {
    if (segment.type === 'speaker') {
      segment.value.dialogue.forEach(d => {
        if (isFloatLessThanOrEqual(d.startTime, time)) {
          throw new Error('Transcript is not monotonic. ' + d.startTime + ' appears after '+ time);
        }
        time = d.startTime;
      });
    }
  });

  return transcript;
}

interface SpeakerOrChapterMap {
  chapter: IChapter;
  speaker: IPISegment;
}

function forEachSpeakerOrChapter(
  transcript: IPITranscript,
  chapters: IChapters,
  callback: <K extends keyof SpeakerOrChapterMap>(type: K, value: SpeakerOrChapterMap[K]) => void
) {
  let chapterIndex = 0;
  let segmentIndex = 0;

  while (chapterIndex < chapters.chapters.length || segmentIndex < transcript.segments.length) {
    const chapter = chapters.chapters[chapterIndex];
    const segment = transcript.segments[segmentIndex];

    if (chapter && segment) {
      if (isFloatLessThanOrEqual(chapter.startTime, segment.startTime)) {
        ++chapterIndex;
        callback('chapter', chapter);
      } else {
        ++segmentIndex;
        callback('speaker', segment);
      }
    } else if (chapter) {
      ++chapterIndex;
      callback('chapter', chapter);
    } else {
      ++segmentIndex;
      callback('speaker', segment);
    }
  }
}

function parseTranscript(piTranscript: IPITranscript, chapters: IChapters): ITranscriptWithSpeakersAndChapters {
  let chapterIndex = 0;
  let dialogueIndex = 0;
  const segments: ISpeakerOrChapterSegment[] = [];

  forEachSpeakerOrChapter(piTranscript, chapters, (type, value) => {
    if (type === 'chapter') {
      const chapter = value as IChapter;
      chapter.index = chapterIndex++;
      segments.push({
        type: 'chapter',
        value: chapter,
      });
    } else {
      const piSegment = value as IPISegment;
      const currentSegment = last(segments);

      // Convert the timestamp to a number in case it's a string.
      // Currently (8/17/21) Buzzsprout returns transcript timetamps as strings.
      // Example:
      //   - Transcript: https://feeds.buzzsprout.com/231452/8212589/transcript.json
      //   - For episode: https://buzzcast.buzzsprout.com/231452/8212589-big-changes-coming-to-apple-podcasts-and-spotify
      //
      // This is inconsistent with the example from the Podcasting 2.0 spec where
      // the transcript represents timestamps as numbers: https://github.com/Podcastindex-org/podcast-namespace/blob/00717cf44987dffe3ff648bc8ba7e25c81f35082/transcripts/example.json
      // I reported the bug to Buzzsprout but I'm not sure when it'll be fixed.
      // In the mean time this type conversion serves as a workaround.
      piSegment.startTime = +piSegment.startTime;

      if (currentSegment !== undefined &&
          currentSegment.type === 'speaker' &&
          currentSegment.value.speaker === piSegment.speaker) {
        const currentDialogue = last(currentSegment.value.dialogue);
        if (currentDialogue.startTime === piSegment.startTime) {
          currentDialogue.body += ' ' + piSegment.body;
        } else {
          currentSegment.value.dialogue.push({
            index: dialogueIndex++,
            startTime: piSegment.startTime,
            body: piSegment.body,
          });
        }
      } else {
        segments.push({
          type: 'speaker',
          value: {
            speaker: piSegment.speaker,
            dialogue: [{
              index: dialogueIndex++,
              startTime: piSegment.startTime,
              body: piSegment.body,
            }]
          }
        });
      }
    }
  });

  return assertTranscriptIsMonotonic({
    segments: segments,
  });
}

function onClickSeekTo(time: number) {
  return event => {
    player.currentTime = time;
    event.preventDefault();
  };
}

function renderTranscriptChapter(chapter: IChapter) {
  return (
    el('h2', {
      id: 'chapter-' + chapter.index,
      style: 'position: sticky; top: -1px; background-color: lightgrey;',
    }, [ text(chapter.title) ])
  );
}

function renderTranscriptSpeaker(segment: ISegment) {
  return p({}, [
    div({ style: 'font-weight: bold' }, [ text(segment.speaker || 'Unidentified Speaker') ]),
    div({}, [].concat.apply([], segment.dialogue.map((d, index) => {
      const aEl = a({ id: 'dialogue-' + d.index, href: '#' }, [ text(d.body) ]);
      aEl.addEventListener('click', onClickSeekTo(d.startTime));

      return (
        index === 0
        ? [ aEl ]
        : [ text(' '), aEl ]
      );
    })))
  ]);
}

function renderTranscript(transcript: ITranscriptWithSpeakersAndChapters) {
  if (transcript.segments.length > 0) {
    const segmentsGroupedByChapter = partitionWhen(transcript.segments, segment => segment.type === 'chapter');
    return div({}, segmentsGroupedByChapter.map(group =>
      div({}, group.map(segment =>
        segment.type === 'chapter' ? renderTranscriptChapter(segment.value)
        : renderTranscriptSpeaker(segment.value)
      ))
    ));
  } else {
    return div({}, [ text('This episode does not include a transcript of type "application/json".') ]);
  }
}

function renderChapters(chapters: IChapters) {
  if (chapters.chapters.length > 0) {
    return el('ol', {},
      chapters.chapters.map(chapter => {
        const chapterHref = '#chapter-' + chapter.index;
        const audioLinkEl = a({ href: chapterHref }, [ text('seek') ]);
        audioLinkEl.addEventListener('click', event => { player.currentTime = chapter.startTime; });
        return el('li', {}, [
          text(chapter.title + ' ('),
          audioLinkEl,
          text(') ('),
          a({ href: chapterHref }, [ text('transcript only') ]),
          text(')'),
        ]);
      })
    );
  } else {
    return div({}, [ text('This episode does not include chapters of type "application/json".') ]);
  }
}

// Turn text-based timestamps into links that seek the player to the appropriate
// point. Examples:
//   - 5:23 (5 minutes and 23 seconds)
//   - 1:31:45 (1 hour 31 minutes and 45 seconds)
function textWithTimestampsAsLinks(s: string) {
  const regex = /((\d+):)?(\d+):(\d+)/g;
  let index = 0;
  let m: RegExpExecArray = undefined;
  const result = [];

  while (m = regex.exec(s)) {
    if (m.index !== index) {
      result.push(text(s.substring(index, m.index)));
    }

    const hours = parseInt(m[2] || '0', 10);
    const minutes = parseInt(m[3] || '0', 10);
    const seconds = parseInt(m[4] || '0', 10);

    const aEl = a({ href: '#' }, [ text(m[0]) ]);
    aEl.addEventListener('click', onClickSeekTo(hours * 60 * 60 + minutes * 60 + seconds));
    result.push(aEl);

    index = m.index + m[0].length;
  }

  if (index < s.length) {
    result.push(text(s.substring(index)));
  }

  return result.length === 1 ? result[0] : el('span', {}, result);
}

// Episodes can express their descriptions in HTML. It's not safe to render raw
// 3rd party HTML. Consequently, we only render a limited set of HTML tags that
// we believe to be safe.
function sanitizedHtmlDescription(node: Node) {
  switch (node.nodeName) {
    case 'B':
    case 'P':
    case 'LI':
    case 'OL':
    case 'STRONG':
    case 'UL':
      return el(node.nodeName, {}, mapNodeList(node.childNodes, sanitizedHtmlDescription));

    case 'A':
      return a({ href: (node as Element).getAttribute('href'), target: '_blank' }, mapNodeList(node.childNodes, sanitizedHtmlDescription));
    case 'BR':
      return el('br');
    case '#text':
      return textWithTimestampsAsLinks(node.nodeValue);
      // return text(node.nodeValue);
    default:
      return el('span', {}, [
        text('<' + node.nodeName + '>'),
        ...mapNodeList(node.childNodes, sanitizedHtmlDescription),
        text('</' + node.nodeName + '>'),
      ]);
  }
}

// Takes a string that contains HTML and converts tags that are deemed to be safe
// into DOM elements. The remaining tags appear as text nodes in the DOM tree.
function renderSanitizedHtml(html: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return div({}, mapNodeList(doc.body.childNodes, sanitizedHtmlDescription));
}

interface IEpisodeWithTranscriptAndChapters extends IEpisode {
  transcript: ITranscriptWithSpeakersAndChapters;
  chapters: IChapters;
}

interface ICurrent {
  podcast: IPodcast;
  episode: IEpisodeWithTranscriptAndChapters;
}

function fetchTranscript(transcriptUrl: string): Promise<IPITranscript> {
  return transcriptUrl
    ? fetch(transcriptUrl).then(response => response.json())
    : Promise.resolve({ segments: [] });
}

function fetchChapters(chaptersUrl: string): Promise<IChapters> {
  return chaptersUrl
    ? fetch(chaptersUrl).then(response => response.json())
    : Promise.resolve({ chapters: [] });
}

function parseCurrent(collectionId: number, doc: Document, episodeEl: Element): Promise<ICurrent> {
  const current = {
    podcast: parsePodcast(collectionId, doc),
    episode: parseEpisode(doc, episodeEl) as IEpisodeWithTranscriptAndChapters,
  };

  return Promise.all([
    fetchTranscript(current.episode.transcriptUrl),
    fetchChapters(current.episode.chaptersUrl),
  ]).then(([transcript, chapters]) => {
    current.episode.transcript = parseTranscript(transcript, chapters);
    current.episode.chapters = chapters;

    return current;
  });
}

function areFloatsEqual(a: number, b: number) {
  return Math.abs(a - b) < 0.0001;
}

function isFloatLessThan(a: number, b: number) {
  return a < b && !areFloatsEqual(a, b);
}

function isFloatLessThanOrEqual(a: number, b: number): boolean {
  return a < b || areFloatsEqual(a, b);
}

function dialogueContainsTime(dialogue: IDialogueWithEnd, time: number): boolean {
  return isFloatLessThanOrEqual(dialogue.startTime, time) && isFloatLessThan(time, dialogue.endTime);
}

// Consume Apple's API's via JSONP so that the requests don't get blocked by
// CORS policy. This is suggested in Apple's docs:
//   > Note: When creating search fields and scripts for your website, you should
//   > use dynamic script tags for your xmlhttp script call requests. For example:
//   > <script src="https://.../search?parameterkeyvalue&callback="{name of JavaScript function in webpage}"/>
// From https://affiliate.itunes.apple.com/resources/documentation/itunes-store-web-service-search-api/
let jsonpId = 0;
function jsonpFetch(url: string, callbackParameterName: string): Promise<any> {
  return new Promise(resolve => {
    const callbackName = 'jsonpCallback' + jsonpId++;
    const scriptEl = el('script', {
      type: 'application/javascript',
      src: url + callbackParameterName + '=' + callbackName,
    });
    window[callbackName] = json => {
      document.head.removeChild(scriptEl);
      delete window[callbackName];
      resolve(json);
    };
    document.head.appendChild(scriptEl);
  });
}

function lookupPodcast(podcastId: string): Promise<IApplePodcast> {
  const url = 'https://itunes.apple.com/lookup?id=' + encodeURIComponent(podcastId);
  return jsonpFetch(url, '&callback')
    .then(json =>
      json.results[0]
    );
}

function searchForPodcastEpisodes(query: string): Promise<{ resultCount: number; results: IAppleEpisode[] }> {
  const url = 'https://itunes.apple.com/search?media=podcast&entity=podcastEpisode&limit=10&term=' + encodeURIComponent(query);
  return jsonpFetch(url, '&callback');
}

function setMessage(message: string) {
  removeChildren(player);
  player.load();

  const contentContainer = document.getElementById('contentContainer');
  removeChildren(contentContainer);
  contentContainer.appendChild(div({}, [ text(message) ]));
  contentContainer.scrollTop = 0;

  currentDialogue = undefined;
  dialogue = [];
}

function renderChaptersAndTranscript(current: ICurrent) {
  return [
    el('h1', {}, [ text('Chapters') ]),
    renderChapters(current.episode.chapters),
    el('h1', {}, [ text('Transcript') ]),
    renderTranscript(current.episode.transcript),
  ];
}

function updateContentDom(current: ICurrent) {
  const contentContainer = document.getElementById('contentContainer');
  removeChildren(contentContainer);

  const descriptionMenuItem = div({ id: 'menu-item-description', class: 'menu-item' + (selectedTab === 'description' ? ' selected' : '') }, [ text('Description') ]);
  descriptionMenuItem.addEventListener('click', event => {
    selectedTab = 'description';
    updateContentDom(current);
    event.preventDefault();
  });
  const transcriptMenuItem = div({ id: 'menu-item-transcript', class: 'menu-item' + (selectedTab === 'transcript' ? ' selected' : '') }, [ text('Chapters & Transcript') ]);
  transcriptMenuItem.addEventListener('click', event => {
    selectedTab = 'transcript';
    updateContentDom(current);
    event.preventDefault();
  });

  contentContainer.appendChild(
    div({ style: 'max-width: 530px; flex: 1;' }, [
      div({ style: 'display: flex; margin-top: 5px; margin-bottom: 16px;' }, [
        descriptionMenuItem,
        transcriptMenuItem,
      ]),
      ...(
        selectedTab === 'transcript' ? renderChaptersAndTranscript(current)
        : [
            p({ style: 'font-weight: bold' }, [
              text(current.podcast.title),
              el('br'),
              text(current.episode.title)
            ]),
            p({}, [ text('Published ' + current.episode.publicationDate.toLocaleString()) ]),
            renderSanitizedHtml(current.episode.encoded || current.episode.description)
          ]
      )
    ])
  );
  contentContainer.scrollTop = 0;
}

function setEpisode(feedUrl: string, collectionId: number, episodeGuid: string) {
  fetch(feedUrl)
    .then(response => {
      return response.text()
        .then(feed => {
          const parser = new DOMParser();
          const doc = parser.parseFromString(feed, 'text/xml');
          const episodeEl = getEpisodeByGuid(doc, episodeGuid);
          parseCurrent(collectionId, doc, episodeEl).then(current => {

            //console.log(current.episode.encoded);
        
            // TODO: Find a better way to manage the DOM.
        
            removeChildren(player);
            player.appendChild(el('source', { type: current.episode.audio.type, src: current.episode.audio.url }));
            player.load();

            selectedTab = 'transcript';
            updateContentDom(current);

            currentDialogue = undefined;
            dialogue = [].concat.apply([], current.episode.transcript.segments.map(segment =>
              segment.type === 'chapter'
              ? []
              : segment.value.dialogue
            ));
            for (let i = 0; i < dialogue.length; ++i) {
              dialogue[i].endTime =
                i < dialogue.length - 1
                ? dialogue[i+1].startTime
                : Number.MAX_VALUE;
            }
          });
        });
    }, error => {
      setMessage('Failed to fetch episode\'s RSS feed. Perhaps it was blocked by CORS policy -- this is a limitation of this demo. Check the dev tools console for details.');
    });
}

interface IAppleEpisode {
  label?: string;
  group?: string;

  collectionId: number;
  collectionName: string;
  feedUrl: string;
  artworkUrl60: string;

  episodeGuid: string;
  trackName: string;
}

interface IApplePodcast {
  feedUrl: string;
}

let ahc: any;
document.addEventListener('DOMContentLoaded', () => {
  player = audio({ controls: 'true', style: 'width: 100%;' });
  
  searchEl = input({ type: 'search', placeholder: 'Search (/)', style: 'width: 100%; max-width: 530px; margin-bottom: 5px;' });
  autocomplete<IAppleEpisode>({
    input: searchEl,
    fetch: (text, update, trigger) => {
      console.log('search: ' + text);
      searchForPodcastEpisodes(text).then(response => {
        update(response.results);
      });
    },
    onSelect: (item, inputEl) => {
      console.log('selected: ' + pp({
        feedUrl: item.feedUrl,
        collectionId: item.collectionId,
        episodeGuid: item.episodeGuid,
      }));
      inputEl.value = '';
      inputEl.blur();
      setEpisode(item.feedUrl, item.collectionId, item.episodeGuid);
    },
    render: (item, currentValue) => {
      return div({ style: 'display: flex; align-items: center; padding-top: 5px; padding-bottom: 5px; padding-left: 0px; padding-right: 0px;'}, [
        el('img', { style: 'width: 60px; height: 60px; margin-right: 5px;', src: item.artworkUrl60 }),
        div({}, [
          div({}, [ text(item.trackName) ]),
          div({}, [ text('From ' + item.collectionName) ]),
        ]),
      ])
    },

    emptyMsg: 'No matches found',
    minLength: 3,
    debounceWaitMs: 1000,
  });

  const hotkeysHelpButton = el('button', { style: 'margin-left: 5px;' }, [ text('?') ]);
  hotkeysHelpButton.addEventListener('click', () => { showHotkeysDialog(); });
  const container = div({ style: 'display: flex; flex-direction: column; height: 100%;' }, [
    div({ style: 'display: flex; flex-direction: column; align-items: center; padding: 5px; background-color: lightgrey;'}, [
      searchEl,
      div({ style: 'display: flex; align-items: center; width: 100%; max-width: 530px;' }, [
        player,
        hotkeysHelpButton,
      ]),
      a({ href: 'https://github.com/rigdern/podcast-transcript-demo/blob/main/README.md', target: '_blank', style: 'margin-top: 5px;' }, [ text('About this Demo') ])
    ]),
    div({ id: 'contentContainer', style: 'flex: 1; overflow: auto; display: flex; justify-content: center; align-items: flex-start;' }, [ div({}, [ text('No episode loaded. Search for an episode to play.') ]) ]),
  ]);

  currentDialogue = undefined;
  dialogue = [];
  player.addEventListener('timeupdate', event => {
    if (selectedTab !== 'transcript' || dialogue.length === 0) return;

    const time = player.currentTime;

    if (currentDialogue === undefined || !dialogueContainsTime(currentDialogue, time)) {
      console.log('dirty: ' + time);

      if (currentDialogue !== undefined) {
        document.querySelector('#dialogue-' + currentDialogue.index).classList.remove('active-dialogue');
      }

      for (let i = 0; i < dialogue.length; ++i) {
        if (dialogueContainsTime(dialogue[i], time)) {
          currentDialogue = dialogue[i];

          const activeDialogueEl = document.querySelector('#dialogue-' + currentDialogue.index);
          activeDialogueEl.classList.add('active-dialogue');
          // activeDialogueEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          //activeDialogueEl.scrollIntoViewIfNeeded();

          break;
        }
      }
    }
  });

  const playbackRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];

  function nextPlaybackRate(playbackRate) {
    for (let i = 0; i < playbackRates.length; ++i) {
      if (playbackRate < playbackRates[i]) {
        return playbackRates[i];
      }
    }

    return last(playbackRates);
  }

  function previousPlaybackRate(playbackRate) {
    for (let i = playbackRates.length  - 1; i >= 0; --i) {
      if (playbackRate > playbackRates[i]) {
        return playbackRates[i];
      }
    }

    return playbackRates[0];
  }

  const hotkeys = [
    ['Spacebar', 'Toggle play/pause'],
    ['Left arrow', 'Seek backwards by 5 seconds'],
    ['Right arrow', 'Seek forwards by 5 seconds'],
    ['<', 'Decrease playback rate'],
    ['>', 'Increase playback rate'],
    ['/', 'Focus the searchbox'],
    ['?', 'Show the hotkeys dialog'],
    ['Esc', 'Hide the hotkeys dialog'],
  ];
  const closeButton = el('span', { style: 'cursor: pointer;' }, [ text('X') ]);
  closeButton.addEventListener('click', () => { hideHotkeysDialog(); });
  const hotkeysDialog = div({ style: 'position: absolute; width: 100%; height: 100%; top: 0; left: 0; display: none; justify-content: center; align-items: flex-start; pointer-events: none;' }, [
    div({ tabindex: '-1', style: 'margin-top: 50px; padding: 15px; border: 3px solid steelblue; background-color: lightgrey; outline: none; pointer-events: auto;' }, [
      div({ style: 'display: flex; justify-content: space-between;' }, [
        el('h4', { style: 'margin-top: 0; margin-left: 0;' }, [ text('Hotkeys') ]),
        closeButton,
      ]),
      el('table', { cellpadding: '4', style: 'border-collapse: collapse;' }, [
        el('tr', {}, [
          el('th', {}, [ text('Key') ]),
          el('th', {}, [ text('Action') ]),
        ]),
        ...hotkeys.map(([key, action]) => 
          el('tr', {}, [
            el('td', {}, [ text(key) ]),
            el('td', {}, [ text(action) ]),
          ]),
        ),
      ]),
    ]),
  ]);
  function showHotkeysDialog() {
    hotkeysDialog.style.display = 'flex';
    (hotkeysDialog.firstElementChild as HTMLElement).focus();
  }
  function hideHotkeysDialog() {
    hotkeysDialog.style.display = 'none';
  }
  hotkeysDialog.firstElementChild.addEventListener('focusout', (event: FocusEvent) => {
    const relatedTarget = event.relatedTarget as Node;
    if (!relatedTarget || !hotkeysDialog.firstElementChild.contains(relatedTarget)) {
      hideHotkeysDialog();
    }
  });

  // Hotkeys borrowed from YouTube.
  document.addEventListener('keydown', event => {
    // TODO: What's a better way to ensure we aren't handling input that was
    //   intended for another control?
    if ((event.target as Element).tagName === 'INPUT') {
      // Ignore keyboard input that is inside of an element that is accepting user input
      // (like a text box).
      return;
    }

    let handled = false;
    switch (event.key) {
      case ' ':
        handled = true;
        player.paused ? player.play() : player.pause();
        break;
      case 'ArrowLeft':
        handled = true;
        player.currentTime -= 5;
        break;
      case 'ArrowRight':
        handled = true;
        player.currentTime += 5;
        break;
      case '<':
        handled = true;
        const rate = previousPlaybackRate(player.playbackRate);
        console.log('rate: ' + rate);
        player.playbackRate = rate;
        break;
      case '>':
        handled = true;
        const rate2 = nextPlaybackRate(player.playbackRate);
        console.log('rate: ' + rate2);
        player.playbackRate = rate2;
        break;
      case '/':
        handled = true;
        searchEl.focus();
        break;
      case '?':
        handled = true;
        showHotkeysDialog();
        break;
      case 'Escape':
        handled = true;
        hideHotkeysDialog();
        break;
    }

    if (handled) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  }, true);

  document.body.appendChild(container);
  document.body.appendChild(hotkeysDialog);

  const urlParams = new URLSearchParams(window.location.search);
  const collectionId = urlParams.get('collectionId');
  const episodeGuid = urlParams.get('episodeGuid');
  if (collectionId && episodeGuid) {
    lookupPodcast(collectionId).then(podcast => {
      if (podcast) {
        setEpisode(podcast.feedUrl, parseInt(collectionId, 10), episodeGuid);
      } else {
        setMessage('Unable to find podcast with ID ' + collectionId);
      }
    });
  }
});
