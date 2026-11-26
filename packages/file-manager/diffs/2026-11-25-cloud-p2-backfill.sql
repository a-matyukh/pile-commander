-- Goes with moderation_mail.moderator_notified_at (schema.sql), once, in the
-- same transaction that adds the column to a database that already has
-- rows. The backend mails the moderator about every card hidden by reports
-- whose row has no stamp; rows from before the column are old news and
-- would all be mailed on the first tick. A fresh database has none.
update public.moderation_mail
   set moderator_notified_at = created_at
 where moderator_notified_at is null
   and kind = 'listing_hidden';
