import { Tree, writeJson } from '@nrwl/devkit';
import { createTreeWithEmptyWorkspace } from '@nrwl/devkit/testing';
import addStorybookWebpackFinal from './update-to-webpackFinals-setup';

describe('Migrate to new setup', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = createTreeWithEmptyWorkspace();

    writeJson(tree, 'workspace.json', {
      projects: {
        ['home-ui-react']: {
          projectType: 'library',
          root: 'libs/home/ui-react',
          sourceRoot: 'libs/home/ui-react/src',
          targets: {
            storybook: {
              builder: '@nrwl/storybook:storybook',
              options: {
                uiFramework: '@storybook/react',
                port: 4400,
                config: {
                  configFolder: 'libs/home/ui-react/.storybook',
                },
              },
            },
          },
        },
        ['ui-angular']: {
          projectType: 'library',
          root: 'libs/home/ui-angular',
          sourceRoot: 'libs/home/ui-angular/src',
          targets: {
            storybook: {
              builder: '@nrwl/storybook:storybook',
              options: {
                uiFramework: '@storybook/angular',
                port: 4400,
                config: {
                  configFolder: 'libs/home/ui-angular/.storybook',
                },
              },
            },
          },
        },
      },
    });

    // write storybook main.js at workspace root
    tree.write(
      '.storybook/main.js',
      `module.exports = {
      stories: [],
      addons: ['@storybook/addon-essentials'],
    };
    `
    );

    tree.write(
      'libs/home/ui-react/.storybook/main.js',
      `module.exports = {
      stories: [],
      addons: ['@storybook/addon-essentials'],
    };
    `
    );
    tree.write(
      'libs/home/ui-angular/.storybook/main.js',
      `module.exports = {
      stories: [],
      addons: ['@storybook/addon-essentials'],
    };
    `
    );
  });

  it(`add webpackFinal to the root level Storybook main.js`, async () => {
    await addStorybookWebpackFinal(tree);

    const mainJsContent = tree.read('.storybook/main.js', 'utf-8');
    expect(mainJsContent.indexOf('webpackFinal')).toBeGreaterThan(-1);
    expect(mainJsContent).toMatchSnapshot();
  });

  it(`add webpackFinal to the project level Storybook main.js`, async () => {
    await addStorybookWebpackFinal(tree);

    const uiAngular = tree.read(
      'libs/home/ui-angular/.storybook/main.js',
      'utf-8'
    );
    expect(uiAngular.indexOf('webpackFinal')).toBeGreaterThan(-1);
    expect(uiAngular).toMatchSnapshot();
    const uiReact = tree.read('libs/home/ui-react/.storybook/main.js', 'utf-8');
    expect(uiReact.indexOf('webpackFinal')).toBeGreaterThan(-1);
    expect(uiReact).toMatchSnapshot();
  });

  it('should remove the root webpack.config.js if the content matches exactly what we generate by default', async () => {
    tree.write(
      '.storybook/webpack.config.js',
      `/**
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
`
    );

    await addStorybookWebpackFinal(tree);

    expect(tree.exists('.storybook/webpack.config.js')).toBeFalsy();
  });

  it('should remove the project specific webpack.config.js if the content matches exactly what we generate by default', async () => {
    const webpackPath = 'libs/home/ui-react/.storybook/webpack.config.js';
    tree.write(
      webpackPath,
      `const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');
   const rootWebpackConfig = require('../../../.storybook/webpack.config');
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
   `
    );

    await addStorybookWebpackFinal(tree);

    expect(tree.exists(webpackPath)).toBeFalsy();
  });
});
