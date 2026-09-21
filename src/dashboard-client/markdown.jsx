import React, { useEffect, useMemo } from 'react';

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
  onRawLinkClick,
  images = [],
  onImageClick,
  shouldHandleRelativeLink = isRelativeMarkdownHref,
  emptyLabel = '',
}) {
  const attachedImages = useMemo(
    () => (Array.isArray(images) ? images.filter((image) => image?.url) : []),
    [images],
  );
  const markdownText = rewriteAttachedImageSources(markdown, sourceSlug, attachedImages);
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

  useEffect(() => {
    if (!editor || editor.isDestroyed || !onImageClick || !attachedImages.length) return undefined;
    const imageElements = Array.from(editor.view.dom.querySelectorAll('img'));
    const interactiveImages = imageElements
      .map((image) => ({ image, index: findAttachedImageIndex(image, attachedImages) }))
      .filter(({ index }) => index >= 0);

    for (const { image, index } of interactiveImages) {
      image.classList.add('markdown-image-trigger');
      image.setAttribute('role', 'button');
      image.setAttribute('tabindex', '0');
      image.setAttribute('aria-label', `Open image ${index + 1} of ${attachedImages.length}`);
    }

    return () => {
      for (const { image } of interactiveImages) {
        image.classList.remove('markdown-image-trigger');
        image.removeAttribute('role');
        image.removeAttribute('tabindex');
        image.removeAttribute('aria-label');
      }
    };
  }, [attachedImages, editor, markdownText, onImageClick]);

  function openImageFromEvent(event) {
    if (!onImageClick) return -1;
    const target = event.target instanceof Element ? event.target : null;
    const image = target?.closest('img');
    if (!image) return -1;
    return findAttachedImageIndex(image, attachedImages);
  }

  if (!markdownText.trim()) {
    return emptyLabel ? <div className="empty-copy">{emptyLabel}</div> : null;
  }

  return (
    <div
      className="markdown-shell"
      onClick={(event) => {
        const imageIndex = openImageFromEvent(event);
        if (imageIndex >= 0) {
          event.preventDefault();
          event.stopPropagation();
          onImageClick(imageIndex);
          return;
        }
        const target = event.target instanceof Element ? event.target : null;
        const anchor = target?.closest('a');
        const href = anchor?.getAttribute('href')?.trim();
        if (!href || !onRelativeLinkClick || !isRelativeMarkdownHref(href) || !shouldHandleRelativeLink(href)) return;
        if (onRawLinkClick && isRelativeRawFileHref(href)) {
          event.preventDefault();
          event.stopPropagation();
          onRawLinkClick({ href, sourceSlug });
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onRelativeLinkClick({ href, sourceSlug });
      }}
      onKeyDown={(event) => {
        if (!onImageClick || !['Enter', ' '].includes(event.key)) return;
        const imageIndex = openImageFromEvent(event);
        if (imageIndex < 0) return;
        event.preventDefault();
        event.stopPropagation();
        onImageClick(imageIndex);
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}

function findAttachedImageIndex(image, attachedImages) {
  const source = image?.currentSrc || image?.src || image?.getAttribute('src') || '';
  return attachedImages.findIndex((attachedImage) => imageUrlsMatch(attachedImage.url, source));
}

function imageUrlsMatch(expected, actual) {
  if (!expected || !actual) return false;
  if (expected === actual) return true;
  try {
    return new URL(expected, document.baseURI).href === new URL(actual, document.baseURI).href;
  } catch {
    return false;
  }
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

function isRelativeRawFileHref(href) {
  const target = String(href || '').split('#')[0];
  return target.split('/').includes('.raw')
    || (/\.[a-z0-9]+$/i.test(target) && !/\.md$/i.test(target));
}
