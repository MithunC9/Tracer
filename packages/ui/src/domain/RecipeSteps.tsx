import type { Recipe } from '@tracer/schema';
import { appName, cx, pad2 } from '../lib.js';
import { Tag } from '../primitives/Type.js';

export interface RecipeStepsProps {
  recipe: Recipe;
  /** id for anchoring ("Build it yourself with this recipe" links here). */
  id?: string;
  headingLevel?: 3 | 4;
  className?: string;
}

const difficultyWord = { easy: 'Easy', moderate: 'Moderate', technical: 'Technical' } as const;

/** A numbered method, like a lab protocol: what you need, the steps, where a person stays in charge. */
export function RecipeSteps({ recipe, id, headingLevel = 3, className }: RecipeStepsProps) {
  const H = `h${headingLevel}` as 'h3';
  return (
    <section className={cx('tr-recipe', className)} id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <header className="tr-recipe__head">
        <p className="tr-kicker">Recipe</p>
        <H className="tr-heading" data-size="title" id={id ? `${id}-title` : undefined}>
          {recipe.title}
        </H>
        <dl className="tr-recipe__facts">
          <div>
            <dt>Setup</dt>
            <dd className="tr-num">~{recipe.estSetupMinutes} min</dd>
          </div>
          <div>
            <dt>Difficulty</dt>
            <dd>{difficultyWord[recipe.difficulty]}</dd>
          </div>
          <div>
            <dt>Steps</dt>
            <dd className="tr-num">{recipe.steps.length}</dd>
          </div>
        </dl>
      </header>

      {recipe.prerequisites.length ? (
        <div className="tr-recipe__block">
          <p className="tr-recipe__sub">Before you start</p>
          <ul className="tr-recipe__prereq">
            {recipe.prerequisites.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ol className="tr-recipe__steps">
        {recipe.steps.map((s) => (
          <li key={s.n} className="tr-recipe__step">
            <span className="tr-recipe__n tr-num" aria-hidden="true">
              {pad2(s.n)}
            </span>
            <div className="tr-recipe__body">
              <p className="tr-recipe__instr">{s.instruction}</p>
              {s.appKey || s.note ? (
                <p className="tr-recipe__meta">
                  {s.appKey ? <Tag tone="plain">{appName(s.appKey)}</Tag> : null}
                  {s.note ? <span className="tr-recipe__note">{s.note}</span> : null}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      {recipe.keepHumanFor.length ? (
        <div className="tr-recipe__human">
          <p className="tr-recipe__sub">Keep a human for</p>
          <ul>
            {recipe.keepHumanFor.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
