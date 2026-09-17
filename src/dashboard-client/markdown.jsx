import React, { useEffect } from 'react';

import { EditorContent, useEditor } from '@tiptap/react';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

function buildExtensions() {
  return [
    StarterKit,
    Table.configure({
      resizable: false,
    }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({
      autolink: false,
      linkOnPaste: false,
      openOnClick: false,
      isAllowedUri: () => true,
    }),
    Image.configure({
      allowBase64: false,
    }),
    Markdown.configure({
      markedOptions: { gfm: true },
    }),
  ];
}

export function MarkdownDocument({
  markdown,
  sourceSlug,
  onRelativeLinkClick,
  images = [],
  shouldHandleRelativeLink = isRelativeMarkdownHref,
  emptyLabel = '',
}) {
  const markdownText = rewriteAttachedImageSources(markdown, sourceSlug, images);
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: false,
      extensions: buildExtensions(),
      content: markdownText,
      contentType: 'markdown',
      editorProps: {
        attributes: {
          class: 'tailwind-prose',
        },
      },
    },
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    try {
      editor.commands.setContent(markdownText, { contentType: 'markdown' });
    } catch (error) {
      if (!editor.isDestroyed) throw error;
    }
  }, [editor, markdownText]);

  if (!markdownText.trim()) {
    return emptyLabel ? <div className="empty-copy">{emptyLabel}</div> : null;
  }

  return (
    <div
      className="markdown-shell"
      onClick={(event) => {
        const target = event.target instanceof Element ? event.target : null;
        const anchor = target?.closest('a');
        const href = anchor?.getAttribute('href')?.trim();
        if (!href || !onRelativeLinkClick || !isRelativeMarkdownHref(href) || !shouldHandleRelativeLink(href)) return;
        event.preventDefault();
        event.stopPropagation();
        onRelativeLinkClick({ href, sourceSlug });
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}

function rewriteAttachedImageSources(markdown, sourceSlug, images) {
  const urlsByPath = new Map(
    (Array.isArray(images) ? images : [])
      .filter((image) => image?.path && image?.url)
      .map((image) => [String(image.path).replace(/^\.\//, ''), image.url]),
  );
  if (!urlsByPath.size || typeof markdown !== 'string') return typeof markdown === 'string' ? markdown : '';
  const collection = String(sourceSlug || '').split('/')[0];
  return markdown.replace(/(!\[[^\]]*\]\()([^\s)]+)(\))/g, (match, prefix, source, suffix) => {
    const normalized = String(source).replace(/^\.\//, '');
    const path = normalized.startsWith('.raw/') && collection ? `${collection}/${normalized}` : normalized;
    return urlsByPath.has(path) ? `${prefix}${urlsByPath.get(path)}${suffix}` : match;
  });
}

function isRelativeMarkdownHref(href) {
  return !/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(href);
}
