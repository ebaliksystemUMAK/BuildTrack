-- Official sources for the standards the built-in checklists cite (shown as "Official source" in checklist Documentation).
-- Additive only: fills a link where a catalog entry has none; existing links, codes, titles and order stay as they are.
-- Each link was opened and its document number confirmed on 2026-10-31 (docs/audits/2026-10-31-builtin-standard-sources.md).
-- No link for NSCP 2015 / PEC 2017 (sold by ASEP / IIEE, no official free text found) or the legacy edition-less "PNS 49".

create or replace function public.fill_documented_standard_sources()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  catalog jsonb;
  updated jsonb;
  added integer;
begin
  select value into catalog from public.system_settings where key = 'standards' for update;
  if catalog is null or jsonb_typeof(catalog) <> 'array' or jsonb_array_length(catalog) = 0 then
    return 0;
  end if;
  select jsonb_agg(case when e ? 'source' or src.url is null then e else e || jsonb_build_object('source', src.url) end order by ord),
         count(*) filter (where not e ? 'source' and src.url is not null)
  into updated, added
  from jsonb_array_elements(catalog) with ordinality x(e, ord)
  left join (values
    -- checked 2026-10-19 (20261028150000)
    ('pns 07:2018', 'https://bps.dti.gov.ph/component/content/article?Itemid=111&id=83'),
    ('pns astm c90:2019 amd. 1:2019', 'https://bps.dti.gov.ph/index.php/press-releases/23-2019/183-dti-bps-adopts-international-standards-on-masonry-units'),
    ('pns astm c129:2019 amd. 1:2019', 'https://bps.dti.gov.ph/index.php/press-releases/23-2019/183-dti-bps-adopts-international-standards-on-masonry-units'),
    ('pns astm c140/c140m:2019', 'https://bps.dti.gov.ph/index.php/press-releases/23-2019/183-dti-bps-adopts-international-standards-on-masonry-units'),
    ('pns 67:2014', 'https://bps.dti.gov.ph/component/content/article?Itemid=111&id=267'),
    ('pgbc 2015', 'https://www.dpwh.gov.ph/DPWH/sites/default/files/laws_codes_orders/PgbcBooklet23March.pdf'),
    ('pns 49:2020', 'https://bps.dti.gov.ph/component/content/article?Itemid=111&id=84'),
    -- checked 2026-10-31: Supreme Court E-Library, NCDA and PRC copies
    ('pd 1096', 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/26/53320'),
    ('dole d.o. 13', 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/10/43886'),
    ('ra 9514', 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/19962'),
    ('ra 11058', 'https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/86355'),
    ('bp 344', 'https://ncda.gov.ph/disability-laws/batas-pambansa/batas-pambansa-blg-344/'),
    ('ra 1378', 'https://www.prc.gov.ph/sites/default/files/Master%20Plumbing%20-%20Board%20Law_0.PDF')
  ) src(code, url) on src.code = lower(btrim(e ->> 'code'));
  if added > 0 then
    update public.system_settings set value = updated, updated_at = now(), updated_by = null where key = 'standards';
  end if;
  return added;
end;
$$;
select public.fill_documented_standard_sources();

revoke all on function public.fill_documented_standard_sources() from public, anon, authenticated;
