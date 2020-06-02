/*
 * math-preview.ts
 *
 * Copyright (C) 2020 by RStudio, PBC
 *
 * Unless you have received this program directly from RStudio pursuant
 * to the terms of a commercial license agreement with RStudio, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

import { Plugin, PluginKey } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { ResolvedPos } from "prosemirror-model";

import debounce from 'lodash.debounce';

import { EditorUIMath } from "../../api/ui";
import { getMarkRange } from "../../api/mark";
import { EditorEvents, EditorEvent } from "../../api/events";
import { applyStyles } from "../../api/css";
import { editingRootNodeClosestToPos } from "../../api/node";
import { createPopup } from "../../api/widgets/widgets";

const key = new PluginKey('math-preview');

export class MathPreviewPlugin extends Plugin {

  private readonly uiMath: EditorUIMath;

  private view: EditorView | null = null;

  private popup: HTMLElement | null = null;
  private lastRenderedMath: string | null = null;
  
  private scrollUnsubscribe: VoidFunction;
  private resizeUnsubscribe: VoidFunction;

  constructor(uiMath: EditorUIMath, events: EditorEvents) {
  
    super({
      key,
      view: () => {
        return {
          update: (view: EditorView) => {
            this.view = view;
            this.updatePopup();
          },
          destroy: () => {
            this.scrollUnsubscribe();
            this.resizeUnsubscribe();
            this.closePopup();
          }
        };
      },
      props: {
        handleDOMEvents: {
          mousemove: debounce((view: EditorView, event: Event) => {
            const ev = event as MouseEvent;
            const pos = view.posAtCoords({ top: ev.clientY, left: ev.clientX });
            if (pos && pos.inside !== -1) {
              this.updatePopup(view.state.doc.resolve(pos.pos));
            }
            return false;
          }, 250),
        },
      },
    });

    // save reference to uiMath
    this.uiMath = uiMath;

    // update position on scroll
    this.updatePopup = this.updatePopup.bind(this);
    this.scrollUnsubscribe = events.subscribe(EditorEvent.Scroll, () => this.updatePopup());
    this.resizeUnsubscribe = events.subscribe(EditorEvent.Resize,  () => this.updatePopup());
  }

  private updatePopup($pos?: ResolvedPos) {

    // bail if we don't have a view
    if (!this.view) {
      return;
    }

    // capture state, etc.
    const state = this.view.state;
    const schema = state.schema;

    // determine math range
    let range: false | { from: number, to: number } = false;

    // if a $pos was passed (e.g. for a mouse hover) then check that first
    if ($pos) {
      range = getMarkRange($pos, schema.marks.math);
    }

    // if that didn't work try the selection
    if (!range) {
      range = getMarkRange(state.selection.$from, schema.marks.math)
    }

    // bail if we don't have a target
    if (!range) {
      this.closePopup();
      return;
    }

    // get the math text. bail if it's empty
    const inlineMath = state.doc.textBetween(range.from, range.to);
    if (inlineMath.match(/^\${1,2}\s*\${1,2}$/)) {
      this.closePopup();
      return;
    }    

    // get the position for the range
    const styles = popupPositionStyles(this.view, range);

    // if the popup already exists just move it
    if (this.popup) {
      applyStyles(this.popup, [], styles);
    } else {
      this.popup = createPopup(this.view, ['pm-math-preview'], undefined, { 
        ...styles,
        visibility: 'hidden'
      });
      this.view.dom.parentNode?.appendChild(this.popup);
    }

    // typeset the math if we haven't already
    if (inlineMath !== this.lastRenderedMath) {
      this.uiMath.typeset!(this.popup!, inlineMath).then(error => {
        if (!error) {
          this.popup!.style.visibility = 'visible';
          this.lastRenderedMath = inlineMath; 
        }
      });
    }
  }

  private closePopup() {
    this.lastRenderedMath = null;
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }
  }

}


function popupPositionStyles(
  view: EditorView, 
  range: { from: number, to: number }
) {

  // get coordinates for editor view (use to offset)
  const editorBox = (view.dom.parentNode! as HTMLElement).getBoundingClientRect();
 
  // +1 to ensure beginning of line doesn't resolve as line before
  // (will subtract it back out below)
  const rangeStartCoords = view.coordsAtPos(range.from + 1); 
  const rangeEndCoords = view.coordsAtPos(range.to);

  // default positions
  const top = Math.round(rangeEndCoords.bottom - editorBox.top) + 10 + 'px';
  let left = `calc(${Math.round(rangeStartCoords.left - editorBox.left)}px - 1ch)`;

  // if it flow across two lines then position at far left of editing root
  if (rangeStartCoords.bottom !== rangeEndCoords.bottom) {
    const editingRoot = editingRootNodeClosestToPos(view.state.doc.resolve(range.from));
    if (editingRoot) {
      const editingEl = view.nodeDOM(editingRoot.pos) as HTMLElement;
      if (editingEl) {
        const editingElStyle = window.getComputedStyle(editingEl);
        left = `calc(${editingEl.getBoundingClientRect().left}px + ${editingElStyle.paddingLeft} - 1ch - 2px)`;
      }
    }
  }

  // return position
  return { top, left };
}


