-- Scanned-PDF OCR metadata and 200 MB private source uploads.
alter table public.sources
  add column if not exists ocr_used boolean not null default false;

alter table public.sources
  add column if not exists ocr_pages integer not null default 0;

update storage.buckets
set file_size_limit = 209715200
where id = 'research-files';
