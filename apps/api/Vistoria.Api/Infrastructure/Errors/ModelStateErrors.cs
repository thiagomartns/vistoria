using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Vistoria.Api.Infrastructure.Errors;

/// <summary>
/// Model state → <c>errors</c> do <c>ProblemDetails</c>, com o caminho JSON do campo como chave
/// (backend.md, "Erros por campo").
/// </summary>
public static class ModelStateErrors
{
    /// <summary>Mensagem dos erros de desserialização, que no System.Text.Json citam tipo .NET, linha e byte.</summary>
    public const string InvalidValueMessage = "Valor ausente ou com formato inválido.";

    private const string JsonRoot = "$";

    public static Dictionary<string, string[]> From(ActionContext context) =>
        From(context.ModelState, BodyParameterNames(context));

    /// <summary>
    /// Erros de desserialização chegam com o caminho do System.Text.Json (<c>$.items[0].quantity</c>, ou <c>$</c>
    /// para o corpo inteiro): o prefixo sai e a mensagem vira <see cref="InvalidValueMessage"/>. O erro "campo
    /// obrigatório" do próprio parâmetro de corpo sai: o motivo real já está na chave do corpo ou do campo.
    /// </summary>
    public static Dictionary<string, string[]> From(
        ModelStateDictionary modelState,
        IReadOnlyCollection<string> bodyParameterNames)
    {
        var errors = new SortedDictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var (key, entry) in modelState)
        {
            if (entry.Errors.Count == 0 || bodyParameterNames.Contains(key))
            {
                continue;
            }

            var fromJson = key == JsonRoot || key.StartsWith(JsonRoot + ".", StringComparison.Ordinal)
                || key.StartsWith(JsonRoot + "[", StringComparison.Ordinal);
            var path = fromJson ? key[JsonRoot.Length..].TrimStart('.') : key;
            var messages = fromJson
                ? [InvalidValueMessage]
                : entry.Errors.Select(e => e.ErrorMessage).ToList();

            if (!errors.TryGetValue(path, out var list))
            {
                errors[path] = list = [];
            }

            list.AddRange(messages.Except(list));
        }

        return errors.ToDictionary(e => e.Key, e => e.Value.ToArray(), StringComparer.Ordinal);
    }

    private static string[] BodyParameterNames(ActionContext context) =>
    [
        .. context.ActionDescriptor.Parameters
            .Where(p => p.BindingInfo?.BindingSource == BindingSource.Body)
            .Select(p => p.BindingInfo?.BinderModelName ?? p.Name),
    ];
}
