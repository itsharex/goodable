"use client";

import { File, Folder, Image, FileText, Video, Music, Archive } from 'lucide-react';

interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  extension?: string;
}

interface FileGridViewProps {
  files: FileItem[];
  onFileClick?: (file: FileItem) => void;
  onFolderClick?: (folder: FileItem) => void;
}

// Truncate filename: max 25 chars for English, 12 chars for Chinese
const truncateFileName = (name: string): string => {
  if (!name) return '';

  const chineseCharCount = (name.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherCharCount = name.length - chineseCharCount;

  // Weight: Chinese char = 2, other char = 1
  const totalWeight = chineseCharCount * 2 + otherCharCount;
  const maxWeight = 25; // ~12 Chinese chars or 25 English chars

  if (totalWeight <= maxWeight) {
    return name;
  }

  // Truncate and add ellipsis
  let truncated = '';
  let currentWeight = 0;

  for (const char of name) {
    const isChinese = /[\u4e00-\u9fa5]/.test(char);
    const charWeight = isChinese ? 2 : 1;

    if (currentWeight + charWeight > maxWeight - 3) { // Reserve space for "..."
      break;
    }

    truncated += char;
    currentWeight += charWeight;
  }

  return truncated + '...';
};

const getFileIcon = (item: FileItem) => {
  if (item.type === 'directory') {
    return <Folder className="w-12 h-12 text-blue-500" />;
  }

  const ext = item.extension?.toLowerCase();

  // Image files
  if (ext && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
    return <Image className="w-12 h-12 text-green-500" />;
  }

  // Video files
  if (ext && ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'].includes(ext)) {
    return <Video className="w-12 h-12 text-purple-500" />;
  }

  // Audio files
  if (ext && ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext)) {
    return <Music className="w-12 h-12 text-pink-500" />;
  }

  // PDF files
  if (ext === 'pdf') {
    return <FileText className="w-12 h-12 text-red-500" />;
  }

  // Archive files
  if (ext && ['zip', 'rar', 'tar', 'gz', '7z'].includes(ext)) {
    return <Archive className="w-12 h-12 text-orange-500" />;
  }

  // Default file icon
  return <File className="w-12 h-12 text-gray-500" />;
};

export default function FileGridView({ files, onFileClick, onFolderClick }: FileGridViewProps) {
  const handleClick = (item: FileItem) => {
    if (item.type === 'directory') {
      onFolderClick?.(item);
    } else {
      onFileClick?.(item);
    }
  };

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2 p-4">
      {files.map((item, index) => (
        <div
          key={index}
          onClick={() => handleClick(item)}
          className="flex flex-col items-center p-2 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors min-w-[80px]"
        >
          <div className="mb-1.5 flex-shrink-0">
            {getFileIcon(item)}
          </div>
          <div className="text-xs text-center text-gray-700 w-full px-0.5 leading-tight break-words line-clamp-2" title={item.name}>
            {truncateFileName(item.name)}
          </div>
          {item.size !== undefined && item.type === 'file' && (
            <div className="text-[10px] text-gray-400 mt-0.5">
              {(item.size / 1024).toFixed(1)} KB
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
