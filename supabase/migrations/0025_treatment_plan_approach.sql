-- Enfoque terapéutico del plan de tratamiento.
--
-- Cierra un hueco dejado explícitamente abierto en la Fase 1 del copiloto:
-- `AnalysisContext.approach` existe desde entonces (ver lib/clinical-state.ts)
-- pero no tenía fuente de datos ni UI. Vive en `treatment_plans`, no en
-- `patients`, porque es un atributo del PLAN vigente, no del paciente en
-- abstracto — un paciente puede pasar por distintos enfoques en distintos
-- planes a lo largo del tratamiento (p. ej. TCC en el primer plan, ACT en
-- uno posterior).
--
-- Lista curada (ver lib/treatment-approach.ts) en vez de texto libre: un
-- valor arbitrario rompería el emparejamiento por texto exacto que usa el
-- estado clínico longitudinal, y le da al prompt de IA un vocabulario
-- cerrado sobre el que razonar.

alter table treatment_plans add column approach text
  check (approach in ('tcc', 'act', 'dbt', 'psicodinamico', 'sistemico', 'humanista', 'emdr', 'integrador'));
