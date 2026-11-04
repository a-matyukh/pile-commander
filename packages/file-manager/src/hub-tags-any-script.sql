-- Apply once to the production project (SQL editor or apply_migration).
-- Hub tags: lowercase letters of any script, digits and hyphens, 2–32
-- characters (was a-z0-9 only). Replaces private.set_hub_listing in place;
-- grants and the public wrapper are unchanged. Existing rows already match.

create or replace function private.set_hub_listing(
    p_workspace uuid,
    p_description text,
    p_tags text[],
    p_allow_fork boolean default true,
    p_preview_key text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_is_public boolean;
    v_tag text;
    v_preview_key text;
    v_max int;
    v_listed bigint;
begin
    if not private.is_workspace_owner(p_workspace) then
        raise exception 'set_hub_listing: only the owner can list on the Hub';
    end if;
    perform private.lock_workspace_tree(p_workspace);

    if not exists (
        select 1 from public.hub_publications h
         where h.source_workspace_id = p_workspace
    ) then
        select b.max_hub_listings into v_max
          from public.billing_accounts b
         where b.owner_id = auth.uid();
        if not found then
            raise exception 'hub_listing_limit: no billing account'
                using errcode = 'P0001',
                      detail = json_build_object('kind', 'hub_limit')::text;
        end if;
        if v_max is not null then
            select count(*) into v_listed
              from public.hub_publications h
             where h.owner_id = auth.uid();
            if v_listed >= v_max then
                raise exception 'hub_listing_limit: % of % Hub listings',
                    v_listed, v_max
                    using errcode = 'P0001',
                          detail = json_build_object(
                              'kind', 'hub_limit',
                              'used_bytes', v_listed,
                              'quota_bytes', v_max
                          )::text;
            end if;
        end if;
    end if;

    select w.is_public into v_is_public
      from public.workspaces w
     where w.id = p_workspace;
    if v_is_public is not true then
        raise exception 'set_hub_listing: make the workspace public first';
    end if;

    -- Lowercase letters of any script, digits and hyphens, 2–32 characters.
    -- ASCII is limited to a-z0-9 and the hyphen; anything from U+00C0 up
    -- passes the range, so the check does not depend on the database locale.
    foreach v_tag in array coalesce(p_tags, '{}') loop
        if v_tag !~ '^[a-z0-9\u00C0-\uFFFF][a-z0-9\u00C0-\uFFFF-]{1,31}$'
           or v_tag <> lower(v_tag) then
            raise exception 'set_hub_listing: invalid tag "%"', v_tag;
        end if;
    end loop;

    v_preview_key := nullif(trim(p_preview_key), '');
    if v_preview_key is not null
       and v_preview_key !~ (
           '^hub/' || p_workspace::text
           || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
       )
    then
        raise exception 'set_hub_listing: invalid preview_key';
    end if;
    -- only objects the backend stat'ed (POST /hub-preview/finalize, size
    -- cap applied) may become a listed preview; a raw PUT is not enough
    if v_preview_key is not null and not exists (
        select 1 from private.hub_preview_uploads u
         where u.storage_key = v_preview_key and u.workspace_id = p_workspace
    ) then
        raise exception 'set_hub_listing: preview upload was not finalized';
    end if;

    update public.workspaces
       set allow_fork = coalesce(p_allow_fork, true)
     where id = p_workspace;

    insert into public.hub_publications
        (source_workspace_id, owner_id, description, tags, allow_fork, preview_key)
    values
        (p_workspace, auth.uid(), coalesce(p_description, ''), coalesce(p_tags, '{}'),
         coalesce(p_allow_fork, true), v_preview_key)
    on conflict (source_workspace_id) do update
       set description = excluded.description,
           tags = excluded.tags,
           allow_fork = excluded.allow_fork,
           preview_key = excluded.preview_key;

    perform private.maybe_auto_hide_hub_listing(p_workspace);
end
$$;
