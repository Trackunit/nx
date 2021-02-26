import {
  formatFiles,
  getProjects,
  joinPathFragments,
  logger,
  readJson,
  stripIndents,
  Tree,
} from '@nrwl/devkit';
import { collapseTextChangeRangesAcrossMultipleVersions } from 'typescript';
import webpack = require('webpack');

export default async function addStorybookWebpackFinal(tree: Tree) {
  let changesMade = false;
  const projects = getProjects(tree);

  projects.forEach((projectConfig, projectName) => {
    const targets = projectConfig.targets;

    const paths = {
      webpackConfig: joinPathFragments(
        projectConfig.root,
        '.storybook/webpack.config.js'
      ),
      mainConfig: joinPathFragments(projectConfig.root, '.storybook/main.js'),
    };

    // find Storybook config for current project
    const storybookExecutor = Object.keys(targets).find(
      (x) => targets[x].executor === '@nrwl/storybook:storybook'
    );

    const hasStorybookConfig =
      storybookExecutor && tree.exists(paths.mainConfig);

    if (!hasStorybookConfig) {
      logger.info(
        `${projectName}: no storybook configured. skipping migration...`
      );
      return;
    }

    // add webpackFinal to storybook config (in a commented way)
    const changes = updateMainJs(tree, paths.mainConfig);
    if (!changesMade) {
      changesMade = changes;
    }

    const originalReactStorybookProjectWebpackConfig = `const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');
    /**
     * Export a function. Accept the base config as the only param.
     *
     * @param {Parameters<typeof rootWebpackConfig>[0]} options
     */
    module.exports = async ({ config, mode }) => {
      config = await rootWebpackConfig({ config, mode });
    
      const tsPaths = new TsconfigPathsPlugin({
        configFile: './tsconfig.base.json',
      });
    
      config.resolve.plugins
        ? config.resolve.plugins.push(tsPaths)
        : (config.resolve.plugins = [tsPaths]);
    
      // Found this here: https://github.com/nrwl/nx/issues/2859
      // And copied the part of the solution that made it work
    
      const svgRuleIndex = config.module.rules.findIndex((rule) => {
        const { test } = rule;
    
        return test.toString().startsWith('/\\.(svg|ico');
      });
      config.module.rules[svgRuleIndex].test =
        /\.(ico|jpg|jpeg|png|gif|eot|otf|webp|ttf|woff|woff2|cur|ani|pdf)(\?.*)?$/;
    
      config.module.rules.push(
        {
          test: /\.(png|jpe?g|gif|webp)$/,
          loader: require.resolve('url-loader'),
          options: {
            limit: 10000, // 10kB
            name: '[name].[hash:7].[ext]',
          },
        },
        {
          test: /\.svg$/,
          oneOf: [
            // If coming from JS/TS file, then transform into React component using SVGR.
            {
              issuer: {
                test: /\.[jt]sx?$/,
              },
              use: [
                {
                  loader: require.resolve('@svgr/webpack'),
                  options: {
                    svgo: false,
                    titleProp: true,
                    ref: true,
                  },
                },
                {
                  loader: require.resolve('url-loader'),
                  options: {
                    limit: 10000, // 10kB
                    name: '[name].[hash:7].[ext]',
                    esModule: false,
                  },
                },
              ],
            },
            // Fallback to plain URL loader.
            {
              use: [
                {
                  loader: require.resolve('url-loader'),
                  options: {
                    limit: 10000, // 10kB
                    name: '[name].[hash:7].[ext]',
                  },
                },
              ],
            },
          ],
        }
      );
    
      return config;
    };
    `;

    const webpackConfigChanges = removeObsoleteWebpackRootConfig(
      tree,
      paths.webpackConfig,
      originalReactStorybookProjectWebpackConfig
    );
    if (!changesMade) {
      changesMade = webpackConfigChanges;
    }
  });

  // update root storybook config
  const changes = updateMainJs(tree, '.storybook/main.js');
  if (!changesMade) {
    changesMade = changes;
  }

  const originalRootStorybookWebpackContent = `/**
* Export a function. Accept the base config as the only param.
* @param {Object} options
* @param {Required<import('webpack').Configuration>} options.config
* @param {'DEVELOPMENT' | 'PRODUCTION'} options.mode - change the build configuration. 'PRODUCTION' is used when building the static version of storybook.
*/
module.exports = async ({ config, mode }) => {
 // Make whatever fine-grained changes you need

 // Return the altered config
 return config;
};
`;

  const webpackConfigChanges = removeObsoleteWebpackRootConfig(
    tree,
    `.storybook/webpack.config.js`,
    originalRootStorybookWebpackContent
  );
  if (!changesMade) {
    changesMade = webpackConfigChanges;
  }

  if (changesMade) {
    await formatFiles(tree);
  }
}

function updateMainJs(tree: Tree, mainConfigPath: string) {
  if (tree.exists(mainConfigPath)) {
    const mainConfigContent = tree.read(mainConfigPath, 'utf-8');
    if (mainConfigPath.indexOf('webpackFinal') === -1) {
      const newMainConfig = mainConfigContent.replace(
        /(};)/,
        `// webpackFinal: async (config, { configType }) => {
//   // Make whatever fine-grained changes you need that should apply to all storybook configs

//   // Return the altered config
//   return config;
// },\n$1`
      );
      tree.write(mainConfigPath, newMainConfig);
      return true;
    }
  }
  return false;
}

function removeObsoleteWebpackRootConfig(
  tree: Tree,
  webpackPath: string,
  originalContent: string
) {
  if (tree.exists(webpackPath)) {
    let webpackWorkspaceContent = tree.read(webpackPath, 'utf-8');

    // clean up dynamic paths in project specific webpack config
    webpackWorkspaceContent = cleanString(webpackWorkspaceContent);
    originalContent = cleanString(originalContent);

    if (webpackWorkspaceContent === originalContent) {
      logger.info(
        ` - Removed ${webpackPath} as it is obsolete and hasn't been modified by the developer.`
      );
      tree.delete(webpackPath);

      return true;
    } else {
      logger.warn(
        ` - Detected modified webpack config at "${webpackPath}". Consider migrating to the new "webpackFinal" property in "main.js".`
      );
    }
  }
  return false;
}

function cleanString(toClean: string) {
  // remove dynamic paths in one of the webpack configs
  toClean = toClean.replace(/const rootWebpackConfig = require\(.*?;/, '');

  // remove all whitespace
  toClean = toClean.replace(/\s+/g, '');

  // remove all newlines
  toClean = toClean.replace(/\n/g, '');

  return toClean;
}
