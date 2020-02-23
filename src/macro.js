import { createMacro, MacroError } from 'babel-plugin-macros'
import { resolve, relative, dirname } from 'path'
import { existsSync } from 'fs'
import findIdentifier from './findIdentifier'
import parseTte from './parseTte'
import addImport from './addImport'
import getStyles from './getStyles'
import replaceWithLocation from './replaceWithLocation'
import resolveConfig from 'tailwindcss/lib/util/resolveConfig'
import processPlugins from 'tailwindcss/lib/util/processPlugins'
import defaultTailwindConfig from 'tailwindcss/stubs/defaultConfig.stub'

// const UTILS_IMPORT_FILEPATH = 'twin.macro/utils.umd'
const TW_CONFIG_DEFAULT_FILENAME = 'tailwind.config.js'

export default createMacro(twinMacro, { configName: 'twin' })

function twinMacro({ babel: { types: t }, references, state, config }) {
  const sourceRoot = state.file.opts.sourceRoot || '.'
  const program = state.file.path
  const configFile = config && config.config
  const configPath = resolve(
    sourceRoot,
    configFile || `./${TW_CONFIG_DEFAULT_FILENAME}`
  )
  const configExists = existsSync(configPath)

  if (configPath && !configExists) {
    throw new MacroError(`Couldn’t find the Tailwind config ${configPath}`)
  }

  state.tailwindConfigIdentifier = program.scope.generateUidIdentifier(
    'tailwindConfig'
  )
  state.tailwindUtilsIdentifier = program.scope.generateUidIdentifier(
    'tailwindUtils'
  )

  const isDev =
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'dev' ||
    false
  state.isDev = isDev
  state.isProd = !isDev

  // Dev mode coming soon
  if (isDev) {
    state.isDev = false
    state.isProd = true
  }

  const foundConfig = configExists
    ? resolveConfig([require(configPath), defaultTailwindConfig])
    : resolveConfig([defaultTailwindConfig])

  state.config = foundConfig

  const getNodeStyles = ({ nodes }) => {
    return nodes.map(({ selector, type, prop, value, nodes, ...rest }) => {
      if (type === 'decl') {
        return {
          type,
          [prop]: value,
          selector,
          nodes: JSON.stringify(nodes),
          rest: JSON.stringify(rest)
        }
      }
      if (type === 'atrule') {
        return {
          type,
          [prop]: value,
          selector,
          nodes: JSON.stringify(nodes),
          rest: JSON.stringify(rest)
        }
      }
      return {
        type,
        [prop]: value,
        selector,
        nodes: JSON.stringify(nodes),
        rest: JSON.stringify(rest)
      }
    })
    // .reduce((acc, item) => {
    //   return {
    //     ...acc,
    //     ...item
    //   }
    // }, {})
  }
  const plugins = processPlugins(foundConfig.plugins, foundConfig)
  const pluginComponents = Array.from(plugins.components).map(
    ({ selector, type, nodes }) => ({
      selector,
      type,
      nodes: JSON.stringify(getNodeStyles({ nodes }))
    })
  )
  console.log(pluginComponents)

  // console.log({ plugins: JSON.stringify(plugins.components) })
  const styledImport =
    config && config.styled
      ? {
          import: config.styled.import || 'default',
          from: config.styled.from || config.styled
        }
      : { import: 'default', from: '@emotion/styled' }

  // state.existingStyledIdentifier =
  //   state.styledIdentifier === null ? false : true
  // state.styledIdentifier = findIdentifier({
  //   program,
  //   mod: styledImport.from,
  //   name: styledImport.import
  // })

  // if (!state.existingStyledIdentifier) {
  //   state.styledIdentifier = program.scope.generateUidIdentifier('styled')
  // }

  state.existingStyledIdentifier = false
  state.styledIdentifier = findIdentifier({
    program,
    mod: styledImport.from,
    name: styledImport.import
  })
  if (state.styledIdentifier === null) {
    state.styledIdentifier = program.scope.generateUidIdentifier('styled')
  } else {
    state.existingStyledIdentifier = true
  }

  state.debug = config.debug || false
  state.configExists = configExists

  program.traverse({
    JSXAttribute(path) {
      if (path.node.name.name !== 'tw') return
      const styles = getStyles(path.node.value.value, t, state)
      const attrs = path
        .findParent(p => p.isJSXOpeningElement())
        .get('attributes')
      const cssAttr = attrs.filter(p => p.node.name.name === 'css')

      if (cssAttr.length) {
        path.remove()
        const expr = cssAttr[0].get('value').get('expression')
        if (expr.isArrayExpression()) {
          expr.pushContainer('elements', styles)
        } else {
          expr.replaceWith(t.arrayExpression([expr.node, styles]))
        }
      } else {
        path.replaceWith(
          t.jsxAttribute(
            t.jsxIdentifier('css'),
            t.jsxExpressionContainer(styles)
          )
        )
      }
    }
  })

  references.default.forEach(path => {
    const parent = path.findParent(x => x.isTaggedTemplateExpression())
    if (!parent) return

    const parsed = parseTte({
      path: parent,
      types: t,
      styledIdentifier: state.styledIdentifier,
      state
    })
    if (!parsed) return

    replaceWithLocation(parsed.path, getStyles(parsed.str, t, state))
  })

  if (state.shouldImportStyled && !state.existingStyledIdentifier) {
    addImport({
      types: t,
      program,
      mod: styledImport.from,
      name: styledImport.import,
      identifier: state.styledIdentifier
    })
  }

  // if (state.shouldImportConfig) {
  //   const configImportPath =
  //     './' + relative(dirname(state.file.opts.filename), configPath)
  //   const originalConfigIdentifier = program.scope.generateUidIdentifier(
  //     'tailwindConfig'
  //   )

  //   program.unshiftContainer(
  //     'body',
  //     t.variableDeclaration('const', [
  //       t.variableDeclarator(
  //         state.tailwindConfigIdentifier,
  //         t.callExpression(
  //           t.memberExpression(
  //             state.tailwindUtilsIdentifier,
  //             t.identifier('resolveConfig')
  //           ),
  //           [configExists ? originalConfigIdentifier : t.objectExpression([])]
  //         )
  //       )
  //     ])
  //   )
  //   if (configExists) {
  //     program.unshiftContainer(
  //       'body',
  //       t.importDeclaration(
  //         [t.importDefaultSpecifier(originalConfigIdentifier)],
  //         t.stringLiteral(configImportPath)
  //       )
  //     )
  //   }
  //   // Add the utils import
  //   program.unshiftContainer(
  //     'body',
  //     t.importDeclaration(
  //       [t.importDefaultSpecifier(state.tailwindUtilsIdentifier)],
  //       t.stringLiteral(UTILS_IMPORT_FILEPATH)
  //     )
  //   )
  // }

  program.scope.crawl()
}
